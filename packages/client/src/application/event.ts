import { NOTICE_SCHEMA, validateEvent } from "@hexagen-monaco/waves-contract";

import { eventsPath } from "../domain/endpoint.js";
import { formatTimestamp } from "../domain/envelope.js";
import type { Command } from "../domain/args.js";
import {
  labelIssueLines,
  readEventId,
  readServerError,
  reasonPhrase,
} from "../domain/reply.js";
import { decideRetry } from "../domain/retry.js";
import { EXIT_OK, EXIT_USAGE, Failure } from "./errors.js";
import { openSession, readProjectToken, transportFor } from "./session.js";
import type { UseCaseDeps } from "./ports.js";

type EventCommand = Extract<Command, { readonly kind: "event" }>;

const LABEL = "waves event";

/**
 * Records one event: a topic, one sentence of text, and optional detail. An
 * event is one immutable entry — no states, no revisions, no answer — so the
 * envelope is fixed: `schema`, `kind`, `project` and `at` are the client's, and
 * `topic` and `text` and `detail?` the owner's. The contract validates the
 * whole record locally; a refusal is exit 2, one issue per line, before a byte
 * goes out.
 *
 * A state write is not idempotent, so like `report` and `state` this POST is not
 * retried once the body may have left the machine: a network error after the body
 * was written is a loss, and a 429 is the one case the server itself says is
 * worth a repeat.
 */
export async function sendEvent(
  command: EventCommand,
  deps: UseCaseDeps,
): Promise<number> {
  const session = await openSession(deps.env, deps.files);
  const { project, token } = await readProjectToken(
    session,
    deps.files,
    deps.env,
  );
  const event = {
    schema: NOTICE_SCHEMA,
    kind: "event",
    project,
    topic: command.topic,
    text: command.text,
    at: formatTimestamp(deps.clock.now()),
    ...(command.detail !== undefined ? { detail: command.detail } : {}),
  };

  const validated = validateEvent(event);
  if (!validated.ok) {
    for (const line of labelIssueLines(LABEL, validated.errors)) {
      deps.err(line);
    }
    deps.err(`${LABEL}: not recorded; fix the event, or ask in the terminal`);
    return EXIT_USAGE;
  }
  const transport = transportFor(session, deps);
  const request = {
    method: "POST",
    url: `${session.endpoint.origin}${eventsPath(project)}`,
    bearer: token,
    body: JSON.stringify(validated.value),
  } as const;

  for (let retries = 0, throttles = 0; ;) {
    const outcome = await transport.send(request);
    if (outcome.kind === "network") {
      if (outcome.beforeBody) {
        const decision = decideRetry({ kind: "network" }, retries);
        if (decision.kind === "wait") {
          retries += 1;
          await deps.sleeper.sleep(decision.ms);
          continue;
        }
      }
      throw new Failure(
        `${outcome.message}; not recorded, ask in the terminal`,
      );
    }
    const { status, headers, body } = outcome.reply;
    if (status === 201) {
      const id = readEventId(body);
      if (id === undefined) {
        throw new Failure("the server sent an unusable body");
      }
      deps.out(`event ${id} recorded for ${project}`);
      return EXIT_OK;
    }
    if (status === 409) {
      deps.err(readServerError(body));
      return 1;
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
      if (decision.kind === "tooLong") {
        throw new Failure(
          `429 Too Many Requests; the server asked to wait ${decision.seconds}s; not recorded, ask in the terminal`,
        );
      }
      if (decision.kind !== "wait") {
        throw new Failure(
          "429 Too Many Requests; not recorded, ask in the terminal",
        );
      }
      throttles += 1;
      await deps.sleeper.sleep(decision.ms);
      continue;
    }
    throw new Failure(
      `${status} ${reasonPhrase(status)}; not recorded, ask in the terminal`,
    );
  }
}
