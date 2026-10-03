import { reasonPhrase, serverFailure } from "../domain/reply.js";
import type { Command } from "../domain/args.js";
import { EXIT_OK, Failure, UsageError } from "./errors.js";
import type { UseCaseDeps } from "./ports.js";
import {
  readCredential,
  requestRegistration,
  type RegistrationResult,
} from "./registration.js";
import { openSession, tokenPath, transportFor } from "./session.js";

type RegisterCommand = Extract<Command, { readonly kind: "register" }>;

/**
 * Registers a project and stores the one token the server will ever send.
 *
 * The request, the retries and the write are `requestRegistration`'s, shared
 * with `register-all` so that the two cannot drift apart on the only part of a
 * registration that costs a token. What is left here is the decision: which
 * credential may be spent, and what each answer is called when a person is
 * reading it.
 */
export async function register(
  command: RegisterCommand,
  deps: UseCaseDeps,
): Promise<number> {
  const session = await openSession(deps.env, deps.files);
  const path = tokenPath(session.configDir, command.id);
  // Before anything else: a directory that cannot hold a secret safely is a
  // refusal, and finding it out after the server has minted a token would mean
  // throwing that token away.
  await deps.files.checkSecretDirectory(session.configDir);
  if (!command.rotate && (await deps.files.exists(path))) {
    throw new UsageError(`${path} already exists; pass --rotate to replace it`);
  }
  const bearer = await readCredential(command.credential, deps);
  const result = await requestRegistration(
    {
      transport: transportFor(session, deps),
      origin: session.endpoint.origin,
      bearer,
      project: { id: command.id, name: command.name, repo: command.repo },
      // The parser refuses `--rotate` with an enrollment token, so this is the
      // owner's decision here and never an enrollment run's.
      rotate: command.rotate,
      path,
    },
    deps,
  );
  return report(command.id, path, result, deps);
}

/**
 * Every answer becomes the throw `register` has always thrown, in the words it
 * has always used: this is a command a user typed, so one answer is one line
 * and the exit code says the run failed. `register-all` reports the same
 * answers across a whole list instead, which is why the two are separate.
 */
function report(
  id: string,
  path: string,
  result: RegistrationResult,
  deps: UseCaseDeps,
): number {
  if (result.kind === "registered") {
    deps.out(`registered ${id}; token saved to ${result.path}`);
    return EXIT_OK;
  }
  if (result.kind === "conflict") {
    throw new Failure(
      `register failed: 409 Conflict; ${id} is registered, pass --rotate to replace its token`,
    );
  }
  if (result.kind === "refused") {
    throw new Failure(
      `register failed: ${result.status} ${reasonPhrase(result.status)}${serverFailure(result.body)}`,
    );
  }
  if (result.kind === "throttled") {
    throw new Failure(
      result.seconds === undefined
        ? "register failed: 429 Too Many Requests"
        : `register failed: 429 Too Many Requests; the server asked to wait ${result.seconds}s`,
    );
  }
  if (result.kind === "lost") {
    // A token that may exist somewhere only the server can see cannot be
    // replaced by asking again: that is what --rotate is for.
    throw new Failure(
      result.sent
        ? `register failed: ${result.message}; the request was sent, so a token may already have been issued and lost; re-run with --rotate to get a new one`
        : `register failed: ${result.message}`,
    );
  }
  if (result.refusal !== undefined) {
    throw new UsageError(
      `${result.refusal.message}; the token the server issued was not saved, so re-run with --rotate`,
    );
  }
  if (result.reason === "noToken") {
    throw new Failure("register failed: the server sent no token");
  }
  throw new Failure(
    `register failed: the token was issued but could not be saved to ${path}; re-run with --rotate`,
  );
}
