import { projectsPath } from "../domain/endpoint.js";
import { readToken } from "../domain/reply.js";
import { decideRetry } from "../domain/retry.js";
import type { Credential } from "../domain/args.js";
import type { ProjectRequest } from "../domain/project-request.js";
import { UsageError } from "./errors.js";
import { FileRefusal, type Transport, type UseCaseDeps } from "./ports.js";

/**
 * What the server answered, as a value rather than an exception.
 *
 * `register` and `register-all` ask the same question of the same server and
 * have to agree on every answer, so the loop that sends the request and writes
 * the token is here once. What is *said* about an answer is not: a command line
 * the user typed and a scheduled run over a list the owner maintains report the
 * same failure very differently, so each caller turns a result into its own
 * line. Nothing in the loop throws for an answer — only a bug, or an `Error` a
 * file the user gave us produced, which a command line reports as itself.
 */
export type RegistrationResult =
  /** A 201 whose token is now on disk, 0600, and named here rather than held. */
  | { readonly kind: "registered"; readonly path: string }
  /** The id is taken. Its token is on some other machine, and this one has none. */
  | { readonly kind: "conflict" }
  /** Any status that is not an answer to this question, with the body to show. */
  | { readonly kind: "refused"; readonly status: number; readonly body: string }
  /**
   * A 429 that ran out of retries, or asked for longer than the cap allows.
   * `seconds` is what the server asked for, and `undefined` when it asked for
   * nothing this client could read.
   */
  | { readonly kind: "throttled"; readonly seconds: number | undefined }
  /**
   * The request produced no answer at all. `sent` says whether the body was on
   * the wire, which is the difference between a POST that could not have minted
   * anything and one whose token the server may have issued into a dead socket.
   */
  | { readonly kind: "lost"; readonly message: string; readonly sent: boolean }
  /**
   * A 201, and no token to keep: either the answer carried none, or the write
   * failed. A refusal from the adapter is carried rather than turned into a
   * message here, because it already says which `chmod` will fix it.
   */
  | {
      readonly kind: "notSaved";
      readonly reason: "noToken" | "writeFailed";
      readonly refusal?: FileRefusal;
    };

export interface RegistrationRequest {
  readonly transport: Transport;
  readonly origin: string;
  readonly bearer: string;
  readonly project: ProjectRequest;
  /** `register --rotate` asks for a token to be replaced. Nothing else can. */
  readonly rotate: boolean;
  /** Where the minted token goes, which is also what the report names. */
  readonly path: string;
}

/**
 * Registers one project and stores the one token the server will ever send.
 *
 * The existing token file is checked before the request, not after: without
 * `--rotate` a refusal costs nothing, and a request that would invalidate a
 * token the user still depends on never leaves the machine.
 *
 * A registration is repeated only while nothing could have been minted. Once the
 * body is on the wire the token exists somewhere the client cannot see, so a
 * dead socket is reported as the loss it is and answered by an admin rotation.
 * A 429 is the one answer worth repeating even so: it is a verdict about the
 * moment rather than about the project, and the server named the wait itself.
 */
export async function requestRegistration(
  request: RegistrationRequest,
  deps: UseCaseDeps,
): Promise<RegistrationResult> {
  const http = {
    method: "POST",
    url: `${request.origin}${projectsPath(request.rotate)}`,
    bearer: request.bearer,
    body: JSON.stringify({
      id: request.project.id,
      name: request.project.name,
      repo: request.project.repo,
    }),
  } as const;
  // Two budgets, counted apart: a server that is broken is not a server that is
  // asking for patience, and neither spends the other's retries.
  let retries = 0;
  let throttles = 0;
  for (;;) {
    const outcome = await request.transport.send(http);
    if (outcome.kind === "network") {
      const decision = decideRetry({ kind: "network" }, retries);
      if (outcome.beforeBody && decision.kind === "wait") {
        retries += 1;
        await deps.sleeper.sleep(decision.ms);
        continue;
      }
      return {
        kind: "lost",
        message: outcome.message,
        sent: !outcome.beforeBody,
      };
    }
    const { status, headers, body } = outcome.reply;
    if (status === 201) {
      const token = readToken(body);
      return token === undefined
        ? { kind: "notSaved", reason: "noToken" }
        : await save(request.path, token, deps);
    }
    if (status === 409) {
      return { kind: "conflict" };
    }
    if (status === 429) {
      const decision = decideRetry(
        {
          kind: "throttled",
          retryAfter: headers["retry-after"],
          now: deps.clock.now(),
        },
        throttles,
      );
      if (decision.kind === "wait") {
        throttles += 1;
        await deps.sleeper.sleep(decision.ms);
        continue;
      }
      return {
        kind: "throttled",
        seconds: decision.kind === "tooLong" ? decision.seconds : undefined,
      };
    }
    return { kind: "refused", status, body };
  }
}

/**
 * A minted token that could not be written down is a failure and not a shrug: it
 * is on disk nowhere but the server's memory, so each caller says exactly that
 * and names the rotation that will make the user whole again.
 *
 * A refusal from the adapter is the other half of the same loss, and it is kept
 * apart: the user has a filesystem to fix, and the refusal already says which
 * `chmod` will fix it. What both share is that the token is gone.
 */
async function save(
  path: string,
  token: string,
  deps: UseCaseDeps,
): Promise<RegistrationResult> {
  try {
    await deps.files.writeSecret(path, token);
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    return error instanceof FileRefusal
      ? { kind: "notSaved", reason: "writeFailed", refusal: error }
      : { kind: "notSaved", reason: "writeFailed" };
  }
  return { kind: "registered", path };
}

/**
 * A token, from a file whose trust is settled by the adapter that opens it, or
 * from standard input. It is never taken from argv or from the environment, so
 * it cannot end up in a shell history or a process listing — and `register-all`
 * has no other way in, since a scheduled run has no terminal to type one.
 *
 * The role is named in a refusal because a file that cannot be read is the same
 * mistake for both roles and the fix is not: an operator who meant the admin
 * token and passed the enrollment file needs to hear which one was missing.
 */
export async function readCredential(
  credential: Credential,
  deps: UseCaseDeps,
): Promise<string> {
  if (credential.source.kind === "stdin") {
    const token = (await deps.input.read()).trim();
    if (token === "") {
      throw new UsageError(`no ${credential.role} token on stdin`);
    }
    return token;
  }
  const file = await deps.files.readSecret(credential.source.path);
  if (file === undefined) {
    throw new UsageError(
      `cannot read the ${credential.role} token at ${credential.source.path}`,
    );
  }
  const token = file.text.trim();
  if (token === "") {
    throw new UsageError(`${credential.source.path} is empty`);
  }
  return token;
}
