import type { Command } from "../domain/args.js";
import { EXIT_OK } from "./errors.js";
import type { UseCaseDeps } from "./ports.js";
import { readJsonInput, sendProjectStatus } from "./send.js";
import { openSession, readProjectToken, transportFor } from "./session.js";

type StatusCommand = Extract<Command, { readonly kind: "status" }>;

/**
 * Sends what the project knows about itself: how many pull-request rows a
 * listing could not read, and what its last `plan:verify` artifact said. Both
 * are facts about the project at a moment, so they go in their own document and
 * their own route rather than into a wave.
 *
 * Reading the project and its token is this command's own work; the document
 * that goes on the wire is built, validated and sent by the shared send path,
 * which is the same one a push and a schedule both use. The token is read the
 * same way a push reads it, from the project's own file, and is never named,
 * printed or taken from the command line.
 */
export async function sendStatus(
  command: StatusCommand,
  deps: UseCaseDeps,
): Promise<number> {
  const session = await openSession(deps.env, deps.files);
  const { project, token } = await readProjectToken(
    session,
    deps.files,
    deps.env,
  );
  const input = await readJsonInput(command.source, deps);
  const receivedAt = await sendProjectStatus(
    {
      session,
      project,
      token,
      input,
      intervalSeconds: command.intervalSeconds,
    },
    { ...deps, transport: transportFor(session, deps) },
  );
  deps.out(`status sent for ${project} at ${receivedAt}`);
  return EXIT_OK;
}
