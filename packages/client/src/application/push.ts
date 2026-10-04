import { lanesOf } from "../domain/envelope.js";
import type { Command, InputSource } from "../domain/args.js";
import { EXIT_OK, UsageError } from "./errors.js";
import type { UseCaseDeps } from "./ports.js";
import { readJsonInput, sendWave } from "./send.js";
import { openSession, readProjectToken, transportFor } from "./session.js";

type PushCommand = Extract<Command, { readonly kind: "push" }>;

/**
 * Sends the project's status for one wave.
 *
 * Reading the project, its token and the lanes is this command's own work; the
 * document that goes on the wire is built, validated and sent by the shared send
 * path, which is the same one a schedule uses for every project it looks after.
 * A push is idempotent, so a request that got no answer at all is worth
 * repeating; a server that refused one is not, however it refused.
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
  const receivedAt = await sendWave(
    {
      session,
      project,
      token,
      wave: command.wave,
      lanes,
      intervalSeconds: command.intervalSeconds,
      includeTails: command.includeTails,
    },
    { ...deps, transport: transportFor(session, deps) },
  );
  deps.out(`pushed ${project}/${command.wave} at ${receivedAt}`);
  return EXIT_OK;
}

async function readLanes(
  source: InputSource,
  deps: UseCaseDeps,
): Promise<readonly unknown[]> {
  const lanes = lanesOf(await readJsonInput(source, deps));
  if (lanes === undefined) {
    throw new UsageError(
      'the input must be {"lanes": [...]} or a waves/v1 envelope',
    );
  }
  return lanes;
}
