import { wavePath } from "../domain/endpoint.js";
import { reasonPhrase, serverFailure } from "../domain/reply.js";
import type { Command } from "../domain/args.js";
import { EXIT_OK, Failure } from "./errors.js";
import type { UseCaseDeps } from "./ports.js";
import { openSession, readProjectToken, transportFor } from "./session.js";

type DeleteCommand = Extract<Command, { readonly kind: "delete" }>;

/**
 * Removes a wave the project no longer has. The same token, and no envelope: a
 * deletion is a statement about what is gone, and re-sending the wave to say so
 * would only have to be undone.
 */
export async function remove(
  command: DeleteCommand,
  deps: UseCaseDeps,
): Promise<number> {
  const session = await openSession(deps.env, deps.files);
  const { project, token } = await readProjectToken(
    session,
    deps.files,
    deps.env,
  );
  const transport = transportFor(session, deps);
  const outcome = await transport.send({
    method: "DELETE",
    url: `${session.endpoint.origin}${wavePath(project, command.wave)}`,
    bearer: token,
  });
  if (outcome.kind === "network") {
    throw new Failure(`delete failed: ${outcome.message}`);
  }
  const { status, body } = outcome.reply;
  if (status === 204) {
    deps.out(`deleted ${project}/${command.wave}`);
    return EXIT_OK;
  }
  if (status === 404) {
    throw new Failure(
      `delete failed: 404 Not Found; ${project}/${command.wave} is not stored`,
    );
  }
  throw new Failure(
    `delete failed: ${status} ${reasonPhrase(status)}${serverFailure(body)}`,
  );
}
