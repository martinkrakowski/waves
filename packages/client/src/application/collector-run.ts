import {
  readCollectorOutput,
  type CollectorOutput,
} from "../domain/collector.js";
import type { SyncProject } from "../domain/sync-config.js";
import { safeText } from "../domain/reply.js";
import type { Environment, RunOutcome, UseCaseDeps } from "./ports.js";
import { PROJECT_VARIABLE } from "./session.js";

/**
 * What a collector is given, and nothing else.
 *
 * A collector is a program the project owns, and it runs as the owner: it could
 * read `~/.config/waves/<project>.token` itself if it wanted to. What this
 * environment refuses is the accident — a collector being *handed* the server, the
 * config directory or a token path it never asked for. `PATH` is there because a
 * collector that calls `node` or `gh` needs it, `HOME` and `LANG` because a
 * program that reads a file or prints a message needs them, and `WAVES_PROJECT`
 * because it is the project being collected: the client's own `WAVES_PROJECT`
 * names whoever ran this command, which under a scheduler is nobody.
 */
const COLLECTOR_ENVIRONMENT = ["PATH", "HOME", "LANG"] as const;

export function collectorEnvironment(
  env: Environment,
  project: string,
): Record<string, string> {
  const given: Record<string, string> = {};
  for (const name of COLLECTOR_ENVIRONMENT) {
    const value = env.get(name);
    if (value !== undefined) {
      given[name] = value;
    }
  }
  given[PROJECT_VARIABLE] = project;
  return given;
}

export type Collection =
  | { readonly ok: true; readonly output: CollectorOutput }
  | { readonly ok: false; readonly reason: string };

/**
 * One project's collector, run once, and what it printed if it printed something
 * this client can send.
 *
 * Only an exit of 0 is a collection. Everything else — a non-zero exit, a
 * timeout, an answer too big to read, a program that could not be started — is one
 * reason, and the caller pushes nothing for it: a project whose collector failed
 * has not said anything about its waves, and an empty wave is a lie the dashboard
 * would read as "nothing to report".
 *
 * Whatever the collector said on stderr goes with the reason, cut to one line:
 * a scheduled run has nobody to read a stack trace, and a log line is the only
 * place the reason will ever be seen.
 */
export async function collect(
  project: SyncProject,
  timeoutMs: number,
  deps: UseCaseDeps,
): Promise<Collection> {
  const outcome = await deps.runner.run({
    command: project.command,
    cwd: project.cwd,
    env: collectorEnvironment(deps.env, project.project),
    timeoutMs,
  });
  if (outcome.kind !== "exit") {
    return { ok: false, reason: reasonOf(outcome) };
  }
  if (outcome.code !== 0) {
    return { ok: false, reason: withNote(exited(outcome.code), outcome) };
  }
  const read = readCollectorOutput(outcome.stdout);
  if (!read.ok) {
    return { ok: false, reason: withNote(read.error, outcome) };
  }
  return { ok: true, output: read.output };
}

/** Why a program that did not exit 0 is not a collection. */
function reasonOf(
  outcome: Exclude<RunOutcome, { readonly kind: "exit" }>,
): string {
  if (outcome.kind === "timeout") {
    return "the collector ran out of time";
  }
  if (outcome.kind === "overflow") {
    return "the collector printed more on stdout than this client reads";
  }
  // The message is the kernel's, and it names the program the file named, so it is
  // made safe to print like every other word this client did not write.
  return `the collector could not be started: ${safeText(outcome.message)}`;
}

/** The exit itself, and the one thing it says that the run cannot work without. */
function exited(code: number | null): string {
  return code === null
    ? "the collector was killed by a signal"
    : `the collector exited ${code}`;
}

function withNote(
  reason: string,
  outcome: { readonly stderr: string; readonly stderrTruncated: boolean },
): string {
  const note = safeText(outcome.stderr);
  if (note === "") {
    return reason;
  }
  return outcome.stderrTruncated
    ? `${reason}: ${note} (its stderr was cut short)`
    : `${reason}: ${note}`;
}
