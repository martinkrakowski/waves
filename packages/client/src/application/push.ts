import { validateEnvelope } from "@hexagen-monaco/waves-contract";

import { wavePath } from "../domain/endpoint.js";
import { issueLines, readReceivedAt } from "../domain/reply.js";
import { buildEnvelope, formatTimestamp, lanesOf } from "../domain/envelope.js";
import type { Command, InputSource } from "../domain/args.js";
import { EXIT_OK, Failure, UsageError } from "./errors.js";
import type { UseCaseDeps } from "./ports.js";
import { readJsonInput, sendIdempotent } from "./send.js";
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

  const reply = await sendIdempotent("push", request, transport, deps);
  const receivedAt = readReceivedAt(reply.body);
  if (receivedAt === undefined) {
    throw new Failure("push failed: the server sent no receivedAt");
  }
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
