import {
  validateEnvelope,
  validateStatus,
} from "@hexagen-monaco/waves-contract";

import type { InputSource } from "../domain/args.js";
import { statusPath, wavePath } from "../domain/endpoint.js";
import { buildEnvelope, formatTimestamp } from "../domain/envelope.js";
import {
  issueLines,
  readReceivedAt,
  reasonPhrase,
  serverFailure,
} from "../domain/reply.js";
import { decideRetry } from "../domain/retry.js";
import { buildStatus } from "../domain/status.js";
import { Failure, UsageError } from "./errors.js";
import type {
  Files,
  HttpReply,
  HttpRequest,
  Transport,
  UseCaseDeps,
} from "./ports.js";
import type { Session } from "./session.js";

/** The two ports reading an input needs, and nothing else. */
type InputDeps = Pick<UseCaseDeps, "files" | "input">;

/** The two ports waiting between two attempts needs, and nothing else. */
type WaitDeps = Pick<UseCaseDeps, "clock" | "sleeper">;

/**
 * The ports the whole send path needs: the clock and the sleeper its retries
 * wait on, and the transport to send on. The transport is a parameter rather
 * than something built here so that a caller which sends many documents for
 * several projects can pace one transport and hand the same one to each send.
 */
type SendDeps = WaitDeps & { readonly transport: Transport };

/**
 * The input a project gave, read from the place it named and parsed as JSON.
 *
 * Both refusals are phrased the way the reader that raises them phrases them —
 * a file that is not there, and text that is not JSON — so that a run refused
 * before the contract is asked reads the same whichever command it was.
 */
export async function readJsonInput(
  source: InputSource,
  deps: InputDeps,
): Promise<unknown> {
  const raw =
    source.kind === "stdin"
      ? await deps.input.read()
      : await readFile(source.path, deps.files);
  try {
    return JSON.parse(raw.trim());
  } catch {
    throw new UsageError("the input is not valid JSON");
  }
}

async function readFile(path: string, files: Files): Promise<string> {
  const text = await files.readText(path);
  if (text === undefined) {
    throw new UsageError(`cannot read ${path}`);
  }
  return text;
}

/** What one wave's send needs to know: which project and wave it is for, and the token that authorises it. */
export interface WaveSend {
  readonly session: Session;
  readonly project: string;
  readonly token: string;
  readonly wave: string;
  readonly lanes: readonly unknown[];
  readonly intervalSeconds: number | null;
  readonly includeTails: boolean;
}

/** What one status document's send needs: the same, without a wave or any lanes. */
export interface StatusSend {
  readonly session: Session;
  readonly project: string;
  readonly token: string;
  readonly input: unknown;
  readonly intervalSeconds: number | null;
}

/**
 * Sends one wave for one project, and answers the instant the server recorded it.
 *
 * This is everything a `push` does after reading its input, with the project and
 * the token as arguments rather than as the ambient `WAVES_PROJECT`, so that a
 * caller working through a list of projects can send for each of them with the
 * same rules a hand push follows. The envelope is built and validated locally
 * before a byte goes out, and what is sent is the contract's own normalised
 * value rather than the draft — so the snapshot on the server is the snapshot
 * that passed validation.
 *
 * Every refusal is the one a push raises, worded as it has always been worded:
 * a bad envelope is a `UsageError` naming the contract's pointers, a `200`
 * without a `receivedAt` or a server that refused is a `Failure` labelled
 * `push`, because that is what this request is whether a person or a schedule
 * asked for it.
 */
export async function sendWave(
  send: WaveSend,
  deps: SendDeps,
): Promise<string> {
  const { session, project, token } = send;
  const draft = buildEnvelope(send.lanes, {
    project,
    wave: send.wave,
    generatedAt: formatTimestamp(deps.clock.now()),
    intervalSeconds: send.intervalSeconds,
    includeTails: send.includeTails,
  });
  const validated = validateEnvelope(draft);
  if (!validated.ok) {
    throw new UsageError(
      `the envelope is not valid:\n${issueLines(validated.errors).join("\n")}`,
    );
  }
  const request = {
    method: "PUT",
    url: `${session.endpoint.origin}${wavePath(project, send.wave)}`,
    bearer: token,
    body: JSON.stringify(validated.value),
  } as const;

  const reply = await sendIdempotent("push", request, deps.transport, deps);
  return receivedAtOf("push", reply);
}

/**
 * Sends one project's status document for one project, and answers the instant
 * the server recorded it.
 *
 * A status PUT replaces the project's one status document, so repeating it can
 * only store the same thing again — which is what makes the shared retry loop the
 * right one, and it is the same loop a push uses. The refusals are the ones a
 * `status` raises: an input that is not a status at all is a `UsageError` before
 * the contract is asked, and anything the contract or the server refuses is a
 * `Failure` labelled `status`.
 */
export async function sendProjectStatus(
  send: StatusSend,
  deps: SendDeps,
): Promise<string> {
  const { session, project, token } = send;
  const draft = buildStatus(send.input, {
    project,
    generatedAt: formatTimestamp(deps.clock.now()),
    intervalSeconds: send.intervalSeconds,
  });
  if (draft === undefined) {
    throw new UsageError(
      "the input must be a JSON object with optional prs and backlog",
    );
  }
  const validated = validateStatus(draft);
  if (!validated.ok) {
    throw new UsageError(
      `the status is not valid:\n${issueLines(validated.errors).join("\n")}`,
    );
  }
  const request = {
    method: "PUT",
    url: `${session.endpoint.origin}${statusPath(project)}`,
    bearer: token,
    body: JSON.stringify(validated.value),
  } as const;

  const reply = await sendIdempotent("status", request, deps.transport, deps);
  return receivedAtOf("status", reply);
}

/** The server's own timestamp for a write that succeeded, or the refusal it always ends in. */
function receivedAtOf(label: "push" | "status", reply: HttpReply): string {
  const receivedAt = readReceivedAt(reply.body);
  if (receivedAt === undefined) {
    throw new Failure(`${label} failed: the server sent no receivedAt`);
  }
  return receivedAt;
}

/**
 * Sends a request that may be repeated, and answers the one reply that means it
 * was taken. This is for a write that replaces what the server already holds — a
 * snapshot, a status — so a second attempt can only store the same thing again.
 * A `delete` keeps its own loop, and a registration keeps its own, which never
 * repeats a 5xx: a registration may already have minted a token.
 *
 * Two budgets, counted apart: a server that is broken is not the same as a
 * server that is asking for patience, and neither of them should spend the
 * other's retries. A 429 is waited for as long as the server asked, up to the
 * cap the retry policy sets, because one write a second per project is a real
 * rate and a project spends it on pushes and on its status alike.
 *
 * Every other ending is a `Failure` named after the command, so the entrypoint
 * prints `waves push: push failed: …` and `waves status: status failed: …`
 * without either use case wording a failure of its own.
 */
export async function sendIdempotent(
  label: "push" | "status",
  request: HttpRequest,
  transport: Transport,
  deps: WaitDeps,
): Promise<HttpReply> {
  let retries = 0;
  let throttles = 0;
  for (;;) {
    const outcome = await transport.send(request);
    if (outcome.kind === "network") {
      const decision = decideRetry({ kind: "network" }, retries);
      if (decision.kind !== "wait") {
        throw new Failure(`${label} failed: ${outcome.message}`);
      }
      retries += 1;
      await deps.sleeper.sleep(decision.ms);
      continue;
    }
    const { status, headers, body } = outcome.reply;
    if (status === 200) {
      return outcome.reply;
    }
    const throttled = status === 429;
    const decision = decideRetry(
      throttled
        ? {
            kind: "throttled",
            retryAfter: headers["retry-after"],
            now: deps.clock.now(),
          }
        : { kind: status >= 500 ? "server" : "refused" },
      throttled ? throttles : retries,
    );
    if (decision.kind === "tooLong") {
      throw new Failure(
        `${label} failed: 429 Too Many Requests; the server asked to wait ${decision.seconds}s`,
      );
    }
    if (decision.kind === "wait") {
      if (throttled) {
        throttles += 1;
      } else {
        retries += 1;
      }
      await deps.sleeper.sleep(decision.ms);
      continue;
    }
    if (throttled) {
      throw new Failure(`${label} failed: 429 Too Many Requests`);
    }
    throw new Failure(
      `${label} failed: ${status} ${reasonPhrase(status)}${serverFailure(body)}`,
    );
  }
}
