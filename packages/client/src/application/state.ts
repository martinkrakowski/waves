import { validateStateEntry } from "@hexagen-monaco/waves-contract";

import { buildStateEntry } from "../domain/decision-document.js";
import { decisionStatesPath } from "../domain/endpoint.js";
import type { Command } from "../domain/args.js";
import {
  labelIssueLines,
  readStateEntryIndex,
  readStaleReply,
  reasonPhrase,
} from "../domain/reply.js";
import { decideRetry } from "../domain/retry.js";
import { EXIT_OK, EXIT_STALE, EXIT_USAGE, Failure } from "./errors.js";
import { openSession, readProjectToken, transportFor } from "./session.js";
import type { UseCaseDeps } from "./ports.js";

type StateCommand = Extract<
  Command,
  { readonly kind: "decision"; readonly action: "state" }
>;

const LABEL = "waves decision state";

/**
 * Records a state change the session itself is making: delegating the decision
 * to the owner, withdrawing a question that went away, or superseding one with
 * a later decision. Like `report`, it posts one state entry with the retry rules
 * of a non-idempotent write, and like `report` a 409 is exit 5 so the caller reads
 * the decision again — but the source is "session" and the answer states that
 * only the owner may give (`approved`, `declined`, `answered`) are refused here
 * with the pointer "use: waves decision report".
 */
export async function state(
  command: StateCommand,
  deps: UseCaseDeps,
): Promise<number> {
  const session = await openSession(deps.env, deps.files);
  const { project, token } = await readProjectToken(
    session,
    deps.files,
    deps.env,
  );
  const entry = buildStateEntry(
    {
      state: command.state,
      source: "session",
      revision: command.revision,
      textSha256: command.textSha256,
      expectedEntries: command.entries,
      by: command.by,
      words: command.words,
      option: command.option,
      reason: command.reason,
      supersededBy: command.supersededBy,
    },
    { project, now: deps.clock.now() },
  );
  const validated = validateStateEntry(entry);
  if (!validated.ok) {
    for (const line of labelIssueLines(LABEL, validated.errors)) {
      deps.err(line);
    }
    deps.err(`${LABEL}: not recorded; fix the entry, or ask in the terminal`);
    return EXIT_USAGE;
  }
  const document = validated.value;
  const transport = transportFor(session, deps);
  const request = {
    method: "POST",
    url: `${session.endpoint.origin}${decisionStatesPath(project, command.id)}`,
    bearer: token,
    body: JSON.stringify(document),
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
      const index = readStateEntryIndex(body);
      if (index === undefined) {
        throw new Failure("the server sent an unusable body");
      }
      deps.out(
        `recorded ${project}/${command.id}: ${command.state}, session, entry ${index}`,
      );
      return EXIT_OK;
    }
    if (status === 409) {
      const stale = readStaleReply(body);
      if (stale === undefined) {
        deps.err(`${LABEL}: stale; read again`);
        return EXIT_STALE;
      }
      deps.err(
        `${LABEL}: stale; current revision ${stale.revision}, textSha256 ${stale.textSha256}, entries ${stale.entries}; read again`,
      );
      return EXIT_STALE;
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
