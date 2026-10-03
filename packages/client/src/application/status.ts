import { validateStatus } from "@hexagen-monaco/waves-contract";

import { statusPath } from "../domain/endpoint.js";
import { formatTimestamp } from "../domain/envelope.js";
import { issueLines, readReceivedAt } from "../domain/reply.js";
import { buildStatus } from "../domain/status.js";
import type { Command } from "../domain/args.js";
import { EXIT_OK, Failure, UsageError } from "./errors.js";
import type { UseCaseDeps } from "./ports.js";
import { readJsonInput, sendIdempotent } from "./send.js";
import { openSession, readProjectToken, transportFor } from "./session.js";

type StatusCommand = Extract<Command, { readonly kind: "status" }>;

/**
 * Sends what the project knows about itself: how many pull-request rows a
 * listing could not read, and what its last `plan:verify` artifact said. Both
 * are facts about the project at a moment, so they go in their own document and
 * their own route rather than into a wave.
 *
 * The document is built and validated locally before a byte goes out, and what
 * is sent is the contract's own normalised value rather than the draft, exactly
 * as a push sends an envelope. The token is read the same way a push reads it,
 * from the project's own file, and is never named, printed or taken from the
 * command line.
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
  const draft = buildStatus(input, {
    project,
    generatedAt: formatTimestamp(deps.clock.now()),
    intervalSeconds: command.intervalSeconds,
  });
  if (draft === undefined) {
    throw new UsageError(
      "the input must be a JSON object with optional prs and backlog",
    );
  }
  const validated = validateStatus(draft);
  if (!validated.ok) {
    throw new UsageError(
      `the status is not valid:\n${issueLines(validated.errors).join("\n")}`,
    );
  }
  const transport = transportFor(session, deps);
  const request = {
    method: "PUT",
    url: `${session.endpoint.origin}${statusPath(project)}`,
    bearer: token,
    body: JSON.stringify(validated.value),
  } as const;

  // A status PUT replaces the project's one status document, so repeating it can
  // only store the same thing again — which is what makes the shared retry loop
  // the right one, and it is the same loop a push uses.
  const reply = await sendIdempotent("status", request, transport, deps);
  const receivedAt = readReceivedAt(reply.body);
  if (receivedAt === undefined) {
    throw new Failure("status failed: the server sent no receivedAt");
  }
  deps.out(`status sent for ${project} at ${receivedAt}`);
  return EXIT_OK;
}
