import { validateEnvelope } from "@hexagen-monaco/waves-contract";

import { wavePath } from "../domain/endpoint.js";
import {
  issueLines,
  reasonPhrase,
  readReceivedAt,
  serverFailure,
} from "../domain/reply.js";
import { decideRetry } from "../domain/retry.js";
import { buildEnvelope, formatTimestamp, lanesOf } from "../domain/envelope.js";
import type { Command, InputSource } from "../domain/args.js";
import { EXIT_OK, Failure, UsageError } from "./errors.js";
import type { UseCaseDeps } from "./ports.js";
import { openSession, readProjectToken, transportFor } from "./session.js";

type PushCommand = Extract<Command, { readonly kind: "push" }>;

/**
 * Sends the project's status for one wave.
 *
 * The envelope is built here and validated locally before a byte goes out, and
 * what is sent is the contract's own normalised value rather than the draft —
 * so the snapshot on the server is the snapshot that passed validation. A push
 * is idempotent, so a request that got no answer at all is worth repeating; a
 * server that refused one is not, however it refused.
 */
export async function push(
  command: PushCommand,
  deps: UseCaseDeps,
): Promise<number> {
  const session = await openSession(deps.env, deps.files);
  const { project, token } = await readProjectToken(
    session,
    deps.files,
    deps.env,
  );
  const lanes = await readLanes(command.source, deps);
  const draft = buildEnvelope(lanes, {
    project,
    wave: command.wave,
    generatedAt: formatTimestamp(deps.clock.now()),
    intervalSeconds: command.intervalSeconds,
    includeTails: command.includeTails,
  });
  const validated = validateEnvelope(draft);
  if (!validated.ok) {
    throw new UsageError(
      `the envelope is not valid:\n${issueLines(validated.errors).join("\n")}`,
    );
  }
  const transport = transportFor(session, deps);
  const request = {
    method: "PUT",
    url: `${session.endpoint.origin}${wavePath(project, command.wave)}`,
    bearer: token,
    body: JSON.stringify(validated.value),
  } as const;

  // Two budgets, counted apart: a server that is broken is not the same as a
  // server that is asking for patience, and neither of them should spend the
  // other's retries.
  let retries = 0;
  let throttles = 0;
  for (;;) {
    const outcome = await transport.send(request);
    if (outcome.kind === "network") {
      const decision = decideRetry({ kind: "network" }, retries);
      if (decision.kind !== "wait") {
        throw new Failure(`push failed: ${outcome.message}`);
      }
      retries += 1;
      await deps.sleeper.sleep(decision.ms);
      continue;
    }
    const { status, headers, body } = outcome.reply;
    if (status === 200) {
      const receivedAt = readReceivedAt(body);
      if (receivedAt === undefined) {
        throw new Failure("push failed: the server sent no receivedAt");
      }
      deps.out(`pushed ${project}/${command.wave} at ${receivedAt}`);
      return EXIT_OK;
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
        `push failed: 429 Too Many Requests; the server asked to wait ${decision.seconds}s`,
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
      throw new Failure("push failed: 429 Too Many Requests");
    }
    throw new Failure(
      `push failed: ${status} ${reasonPhrase(status)}${serverFailure(body)}`,
    );
  }
}

async function readLanes(
  source: InputSource,
  deps: UseCaseDeps,
): Promise<readonly unknown[]> {
  const raw =
    source.kind === "stdin"
      ? await deps.input.read()
      : await readFile(source.path, deps);
  let input: unknown;
  try {
    input = JSON.parse(raw.trim());
  } catch {
    throw new UsageError("the input is not valid JSON");
  }
  const lanes = lanesOf(input);
  if (lanes === undefined) {
    throw new UsageError(
      'the input must be {"lanes": [...]} or a waves/v1 envelope',
    );
  }
  return lanes;
}

async function readFile(path: string, deps: UseCaseDeps): Promise<string> {
  const text = await deps.files.readText(path);
  if (text === undefined) {
    throw new UsageError(`cannot read ${path}`);
  }
  return text;
}
