import { validateDecision } from "@hexagen-monaco/waves-contract";

import type { Command } from "../domain/args.js";
import { decisionPath } from "../domain/endpoint.js";
import { completeDecision } from "../domain/decision-document.js";
import {
  labelIssueLines,
  readRaiseReply,
  readServerError,
  reasonPhrase,
} from "../domain/reply.js";
import { decideRetry } from "../domain/retry.js";
import {
  EXIT_FAILURE,
  EXIT_OK,
  EXIT_USAGE,
  Failure,
  UsageError,
} from "./errors.js";
import type { UseCaseDeps } from "./ports.js";
import { readJsonInput } from "./send.js";
import { openSession, readProjectToken, transportFor } from "./session.js";

type RaiseCommand = Extract<
  Command,
  { readonly kind: "decision"; readonly action: "raise" }
>;

const LABEL = "waves decision raise";

/**
 * Raises one decision for the session's project.
 *
 * The user supplies the decision's own fields in a file; the client fills in the
 * keys it owns (schema, kind, project, raisedAt), validates the result through the
 * contract, and PUTs it. A raise is safe to repeat — an identical document makes
 * no revision — so it retries the same way `status` does: a network failure, a
 * 5xx and a 429 are retried, and any other 4xx is refused at once.
 *
 * A local validation failure is exit 2, printed one issue per line, before a byte
 * goes out: the user fixes the document, not the server. A 409 from the server is a
 * bound (too many decisions, too many revisions), and the server's own message is
 * printed as-is. Every other failure after retries ends with "ask in the terminal":
 * a session that cannot raise falls back to asking the owner directly, and this is
 * the line the owner sees.
 */
export async function raise(
  command: RaiseCommand,
  deps: UseCaseDeps,
): Promise<number> {
  const session = await openSession(deps.env, deps.files);
  const { project, token } = await readProjectToken(
    session,
    deps.files,
    deps.env,
  );
  const input = await readJsonInput(command.source, deps);
  const completed = completeDecision(input, {
    project,
    now: deps.clock.now(),
  });
  if (!completed.ok) {
    throw new UsageError(completed.reason);
  }
  const validated = validateDecision(completed.document);
  if (!validated.ok) {
    for (const line of labelIssueLines(LABEL, validated.errors)) {
      deps.err(line);
    }
    deps.err(`${LABEL}: not raised; fix the document, or ask in the terminal`);
    return EXIT_USAGE;
  }
  const document = validated.value;
  const transport = transportFor(session, deps);
  const request = {
    method: "PUT",
    url: `${session.endpoint.origin}${decisionPath(project, document.id)}`,
    bearer: token,
    body: JSON.stringify(document),
  } as const;

  for (let retries = 0, throttles = 0; ;) {
    const outcome = await transport.send(request);
    if (outcome.kind === "network") {
      const decision = decideRetry({ kind: "network" }, retries);
      if (decision.kind !== "wait") {
        throw new Failure(
          `${outcome.message}; not raised, ask in the terminal`,
        );
      }
      retries += 1;
      await deps.sleeper.sleep(decision.ms);
      continue;
    }
    const { status, headers, body } = outcome.reply;
    if (status === 200) {
      const reply = readRaiseReply(body);
      if (reply === undefined) {
        throw new Failure("the server sent an unusable body");
      }
      deps.out(
        `raised ${project}/${document.id}: revision ${reply.revision} (${reply.created ? "new" : "unchanged"}), textSha256 ${reply.textSha256}, entries ${reply.entries}`,
      );
      return EXIT_OK;
    }
    if (status === 409) {
      deps.err(readServerError(body));
      return EXIT_FAILURE;
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
          `429 Too Many Requests; the server asked to wait ${decision.seconds}s; not raised, ask in the terminal`,
        );
      }
      if (decision.kind !== "wait") {
        throw new Failure(
          `429 Too Many Requests; not raised, ask in the terminal`,
        );
      }
      throttles += 1;
      await deps.sleeper.sleep(decision.ms);
      continue;
    }
    const decision = decideRetry(
      { kind: status >= 500 ? "server" : "refused" },
      retries,
    );
    if (decision.kind === "wait") {
      retries += 1;
      await deps.sleeper.sleep(decision.ms);
      continue;
    }
    throw new Failure(
      `${status} ${reasonPhrase(status)}; not raised, ask in the terminal`,
    );
  }
}
