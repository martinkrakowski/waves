import { validateStateEntry } from "@hexagen-monaco/waves-contract";

import { decisionStatesPath } from "../domain/endpoint.js";
import { buildStateEntry } from "../domain/decision-document.js";
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

type ReportCommand = Extract<
  Command,
  { readonly kind: "decision"; readonly action: "report" }
>;

const LABEL = "waves decision report";

/**
 * Records the owner's answer from the terminal.
 *
 * A report is one state entry: `{ state, source: "reported", revision,
 * textSha256, expectedEntries, by, at, words, option? }`. The client fills in
 * `source` and `by` and `at`, then the contract validates the whole entry
 * locally; a refusal is exit 2, printed one issue per line, before a byte goes
 * out. A state write is not idempotent — it appends a row — so unlike `raise` it
 * is not repeated once the request may have been sent: a network error after the
 * body was written is reported as the loss it is, and a 429 is the one case the
 * server itself says is worth a single repeat.
 *
 * A 409 means the pin is stale: the decision moved while the session was not
 * looking, so the entry it read no longer matches. Exit 5 says "read again".
 */
export async function report(
  command: ReportCommand,
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
      source: "reported",
      revision: command.revision,
      textSha256: command.textSha256,
      expectedEntries: command.entries,
      by: command.by,
      words: command.words,
      option: command.option,
      reason: undefined,
      supersededBy: undefined,
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
  const transport = transportFor(session, deps);
  const request = {
    method: "POST",
    url: `${session.endpoint.origin}${decisionStatesPath(project, command.id)}`,
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
        throw new Failure(
          `${outcome.message}; not recorded, ask in the terminal`,
        );
      }
      throw new Failure(
        `${outcome.message}; it may or may not have been recorded: read the decision before writing again`,
      );
    }
    const { status, headers, body } = outcome.reply;
    if (status === 201) {
      const index = readStateEntryIndex(body);
      if (index === undefined) {
        throw new Failure(
          "the server sent an unusable body; it may or may not have been recorded: read the decision before writing again",
        );
      }
      deps.out(
        `recorded ${project}/${command.id}: ${command.state}, reported, entry ${index}`,
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
    if (status >= 500) {
      throw new Failure(
        `${status} ${reasonPhrase(status)}; it may or may not have been recorded: read the decision before writing again`,
      );
    }
    throw new Failure(
      `${status} ${reasonPhrase(status)}; not recorded, ask in the terminal`,
    );
  }
}
