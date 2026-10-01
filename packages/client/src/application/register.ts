import { projectsPath } from "../domain/endpoint.js";
import { isTightMode, modeText } from "../domain/secret.js";
import { reasonPhrase, readToken, serverFailure } from "../domain/reply.js";
import type { AdminTokenSource, Command } from "../domain/args.js";
import { EXIT_OK, Failure, UsageError } from "./errors.js";
import type { UseCaseDeps } from "./ports.js";
import { openSession, tokenPath, transportFor } from "./session.js";

type RegisterCommand = Extract<Command, { readonly kind: "register" }>;

/**
 * Registers a project and stores the one token the server will ever send.
 *
 * The existing token file is checked before the request, not after: without
 * `--rotate` a refusal costs nothing, and a request that would invalidate a
 * token the user still depends on never leaves the machine.
 */
export async function register(
  command: RegisterCommand,
  deps: UseCaseDeps,
): Promise<number> {
  const session = await openSession(deps.env, deps.files);
  const path = tokenPath(session.configDir, command.id);
  if (!command.rotate && (await deps.files.exists(path))) {
    throw new UsageError(`${path} already exists; pass --rotate to replace it`);
  }
  const adminToken = await readAdminToken(command.adminToken, deps);
  const transport = transportFor(session, deps);
  const outcome = await transport.send({
    method: "POST",
    url: `${session.endpoint.origin}${projectsPath(command.rotate)}`,
    bearer: adminToken,
    body: JSON.stringify({
      id: command.id,
      name: command.name,
      repo: command.repo,
    }),
  });
  if (outcome.kind === "network") {
    throw new Failure(`register failed: ${outcome.message}`);
  }
  const { status, body } = outcome.reply;
  if (status === 201) {
    const token = readToken(body);
    if (token === undefined) {
      throw new Failure("register failed: the server sent no token");
    }
    await deps.files.writeSecret(path, token);
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

/**
 * The admin token, from a file whose mode is checked or from standard input.
 * It is never taken from argv or from the environment, so it cannot end up in a
 * shell history or in a process listing.
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
  if (!isTightMode(file.mode)) {
    throw new UsageError(
      `${source.path} is mode ${modeText(file.mode)}; the admin token must be 0600 or stricter`,
    );
  }
  const token = file.text.trim();
  if (token === "") {
    throw new UsageError(`${source.path} is empty`);
  }
  return token;
}
