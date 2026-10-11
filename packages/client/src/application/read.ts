import type { Command } from "../domain/args.js";
import { decisionPath } from "../domain/endpoint.js";
import { readDecisionRecord, reasonPhrase } from "../domain/reply.js";
import { EXIT_OK, Failure } from "./errors.js";
import type { UseCaseDeps } from "./ports.js";
import { readSigned } from "./read-signed.js";
import { openSession, readProject, transportFor } from "./session.js";

type ReadCommand = Extract<
  Command,
  { readonly kind: "decision"; readonly action: "read" }
>;

/**
 * Reads one decision and prints its full record as one line of JSON.
 *
 * Reads need no token: the route is public, so the GET carries none and the
 * project's token file is never touched. A read that answers carries no news
 * about whether the owner has answered — exit 0 only means the record was read
 * and printed, never that the owner decided.
 *
 * A 404 is a specific refusal, named by the decision's id; every other failure
 * is a network or server problem, reported through the same `Failure` the other
 * commands use so the entrypoint prints it with the `waves decision read` label.
 */
export async function readDecision(
  command: ReadCommand,
  deps: UseCaseDeps,
): Promise<number> {
  const session = await openSession(deps.env, deps.files);
  const project = readProject(deps.env);
  const transport = transportFor(session, deps);
  const request = {
    method: "GET",
    url: `${session.endpoint.origin}${decisionPath(project, command.id)}`,
  } as const;

  const outcome = await transport.send(request);
  if (outcome.kind === "network") {
    throw new Failure(outcome.message);
  }
  const { status, body } = outcome.reply;
  if (status === 200) {
    const record = readDecisionRecord(body, command.id);
    if (record === undefined) {
      throw new Failure("the server sent an unusable body");
    }
    // `readDecisionRecord` has checked and re-encoded the body, so the parse
    // here is of a JSON string this module has just written itself.
    if (command.signed) {
      return await readSigned(
        command,
        deps,
        JSON.parse(record) as Record<string, unknown>,
        project,
      );
    }
    deps.out(record);
    return EXIT_OK;
  }
  if (status === 404) {
    throw new Failure(`no such decision ${command.id}`);
  }
  throw new Failure(`${status} ${reasonPhrase(status)}`);
}
