import type { Command } from "../domain/args.js";
import {
  buildMarkdown,
  isReportedAnswer,
  matchesSince,
  readHeads,
  readRecord,
  type DecisionRecord,
} from "../domain/decision-export.js";
import { decisionPath, projectDecisionsPath } from "../domain/endpoint.js";
import { reasonPhrase } from "../domain/reply.js";
import { EXIT_OK, Failure } from "./errors.js";
import { openSession, readProject, transportFor } from "./session.js";
import type { UseCaseDeps } from "./ports.js";

type ExportCommand = Extract<
  Command,
  { readonly kind: "decisions"; readonly action: "export" }
>;

/**
 * Exports the owner's reported answers as Markdown for `policy.md`.
 *
 * Reads are public, so the two GETs carry no token. The whole list is fetched
 * before a single line is printed: a failure on any decision's fetch aborts the
 * run with exit 1 and empty stdout, so a half-printed table is never handed to
 * a file. Only heads whose current state is an answer by a reported source are
 * fetched at all — a question that is still `open` is not, and a `session` answer
 * is shown as the session's claim and never copies into `policy.md`.
 *
 * `--since` keeps only answers received on or after the date, so a policy review
 * can ask for one week's answers rather than every one the service has kept.
 */
export async function exportDecisions(
  command: ExportCommand,
  deps: UseCaseDeps,
): Promise<number> {
  const session = await openSession(deps.env, deps.files);
  const project = readProject(deps.env);
  const transport = transportFor(session, deps);

  const readOutcome = await transport.send({
    method: "GET",
    url: `${session.endpoint.origin}${projectDecisionsPath(project)}`,
  });
  if (readOutcome.kind === "network") {
    throw new Failure(readOutcome.message);
  }
  const { status: listStatus, body: listBody } = readOutcome.reply;
  if (listStatus !== 200) {
    throw new Failure(`${listStatus} ${reasonPhrase(listStatus)}`);
  }
  // The list is refused as a whole when it is not the object with a `decisions`
  // array the route should answer: a half-parsed list is no basis for a table.
  const heads = readHeads(listBody);
  if (heads === undefined) {
    throw new Failure("the server sent an unusable body");
  }
  const records: DecisionRecord[] = [];
  for (const head of heads) {
    if (!isReportedAnswer(head)) {
      continue;
    }
    const outcome = await transport.send({
      method: "GET",
      url: `${session.endpoint.origin}${decisionPath(project, head.id)}`,
    });
    if (outcome.kind === "network") {
      throw new Failure(outcome.message);
    }
    const { status, body } = outcome.reply;
    if (status !== 200) {
      throw new Failure(`${status} ${reasonPhrase(status)}`);
    }
    const record = readRecord(body);
    if (record === undefined) {
      throw new Failure("the server sent an unusable body");
    }
    // A record whose head does not name the decision that was fetched is not the
    // one asked for: a half-printed table is worse than none, so the run aborts
    // with exit 1 and empty stdout.
    if (record.head.id !== head.id) {
      throw new Failure("the server sent an unusable body");
    }
    // A head that was an answer on the list can stop being one while it is
    // fetched, so the check is done again on the fresh record: a question that
    // is still open is left out, never half-printed.
    if (!isReportedAnswer(record.head)) {
      continue;
    }
    // An answer with no entry on the head's textSha256/state/source is two
    // things the server said that disagree: print neither, the response is
    // unusable.
    if (record.entry === undefined) {
      throw new Failure("the server sent an unusable body");
    }
    if (!matchesSince(record.entry.receivedAt, command.since)) {
      continue;
    }
    records.push(record);
  }
  deps.out(buildMarkdown(records));
  return EXIT_OK;
}
