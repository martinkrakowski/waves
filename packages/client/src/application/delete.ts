import { wavePath } from "../domain/endpoint.js";
import { reasonPhrase, serverFailure } from "../domain/reply.js";
import { decideRetry } from "../domain/retry.js";
import type { Command } from "../domain/args.js";
import { EXIT_OK, Failure } from "./errors.js";
import type { UseCaseDeps } from "./ports.js";
import { openSession, readProjectToken, transportFor } from "./session.js";

type DeleteCommand = Extract<Command, { readonly kind: "delete" }>;

/**
 * Removes a wave the project no longer has. The same token, and no envelope: a
 * deletion is a statement about what is gone, and re-sending the wave to say so
 * would only have to be undone. A deletion is also idempotent, so unlike a push
 * it is worth repeating after a 5xx or a socket that died — the second attempt
 * can only answer 204 or 404.
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
  const request = {
    method: "DELETE",
    url: `${session.endpoint.origin}${wavePath(project, command.wave)}`,
    bearer: token,
  } as const;

  for (let retries = 0; ; retries += 1) {
    const outcome = await transport.send(request);
    if (outcome.kind === "network") {
      const decision = decideRetry({ kind: "network" }, retries);
      if (decision.kind !== "wait") {
        throw new Failure(`delete failed: ${outcome.message}`);
      }
      await deps.sleeper.sleep(decision.ms);
      continue;
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
    const decision = decideRetry(
      { kind: status >= 500 ? "server" : "refused" },
      retries,
    );
    if (decision.kind === "wait") {
      await deps.sleeper.sleep(decision.ms);
      continue;
    }
    throw new Failure(
      `delete failed: ${status} ${reasonPhrase(status)}${serverFailure(body)}`,
    );
  }
}
