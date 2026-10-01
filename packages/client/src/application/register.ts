import { projectsPath } from "../domain/endpoint.js";
import { reasonPhrase, readToken, serverFailure } from "../domain/reply.js";
import { decideRetry } from "../domain/retry.js";
import type { AdminTokenSource, Command } from "../domain/args.js";
import { EXIT_OK, Failure, UsageError } from "./errors.js";
import { FileRefusal, type UseCaseDeps } from "./ports.js";
import { openSession, tokenPath, transportFor } from "./session.js";

type RegisterCommand = Extract<Command, { readonly kind: "register" }>;

/**
 * Registers a project and stores the one token the server will ever send.
 *
 * The existing token file is checked before the request, not after: without
 * `--rotate` a refusal costs nothing, and a request that would invalidate a
 * token the user still depends on never leaves the machine.
 *
 * A registration is repeated only while nothing could have been minted. Once the
 * body is on the wire the token exists somewhere the client cannot see, so a
 * dead socket is reported as the loss it is and answered with `--rotate`.
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
  const adminToken = await readAdminToken(command.adminToken, deps);
  const transport = transportFor(session, deps);
  const request = {
    method: "POST",
    url: `${session.endpoint.origin}${projectsPath(command.rotate)}`,
    bearer: adminToken,
    body: JSON.stringify({
      id: command.id,
      name: command.name,
      repo: command.repo,
    }),
  } as const;

  for (let retries = 0; ; retries += 1) {
    const outcome = await transport.send(request);
    if (outcome.kind === "network") {
      // A token that may exist somewhere only the server can see cannot be
      // replaced by asking again: that is what --rotate is for.
      if (!outcome.beforeBody) {
        throw new Failure(
          `register failed: ${outcome.message}; the request was sent, so a token may already have been issued and lost; re-run with --rotate to get a new one`,
        );
      }
      const decision = decideRetry({ kind: "network" }, retries);
      if (decision.kind !== "wait") {
        throw new Failure(`register failed: ${outcome.message}`);
      }
      await deps.sleeper.sleep(decision.ms);
      continue;
    }
    const { status, body } = outcome.reply;
    if (status === 201) {
      const token = readToken(body);
      if (token === undefined) {
        throw new Failure("register failed: the server sent no token");
      }
      await save(deps, path, token);
      deps.out(`registered ${command.id}; token saved to ${path}`);
      return EXIT_OK;
    }
    if (status === 409) {
      throw new Failure(
        `register failed: 409 Conflict; ${command.id} is registered, pass --rotate to replace its token`,
      );
    }
    throw new Failure(
      `register failed: ${status} ${reasonPhrase(status)}${serverFailure(body)}`,
    );
  }
}

/**
 * A minted token that could not be written down is a failure and not a shrug:
 * it is on disk nowhere but the server's memory, so it says exactly that and
 * names the rotation that will make the user whole again.
 *
 * A refusal from the adapter is the other half of the same loss, and it is kept
 * apart: the user has a filesystem to fix, and the refusal already says which
 * `chmod` will fix it. What both share is that the token is gone.
 */
async function save(
  deps: UseCaseDeps,
  path: string,
  token: string,
): Promise<void> {
  try {
    await deps.files.writeSecret(path, token);
  } catch (error) {
    if (error instanceof FileRefusal) {
      throw new UsageError(
        `${error.message}; the token the server issued was not saved, so re-run with --rotate`,
      );
    }
    throw new Failure(
      `register failed: the token was issued but could not be saved to ${path}; re-run with --rotate`,
    );
  }
}

/**
 * The admin token, from a file whose trust is settled by the adapter that opens
 * it, or from standard input. It is never taken from argv or from the
 * environment, so it cannot end up in a shell history or a process listing.
 */
async function readAdminToken(
  source: AdminTokenSource,
  deps: UseCaseDeps,
): Promise<string> {
  if (source.kind === "stdin") {
    const token = (await deps.input.read()).trim();
    if (token === "") {
      throw new UsageError("no admin token on stdin");
    }
    return token;
  }
  const file = await deps.files.readSecret(source.path);
  if (file === undefined) {
    throw new UsageError(`cannot read the admin token at ${source.path}`);
  }
  const token = file.text.trim();
  if (token === "") {
    throw new UsageError(`${source.path} is empty`);
  }
  return token;
}
