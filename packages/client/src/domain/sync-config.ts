import { isRecord, own } from "./object.js";
import { readSyncProject, type SyncProject } from "./sync-project.js";

/**
 * What the whole run is paced by, and what every wave and status it sends says
 * its own interval is. It is an integer of seconds between 10 and 100 because it
 * is also the staleness budget: a wave pushed with this interval goes stale after
 * `3 × every` seconds, so the ceiling of 100 keeps that under the contract's 300
 * and a healthy tick is never mistaken for a stopped pusher.
 */
export const MIN_EVERY_SECONDS = 10;
export const MAX_EVERY_SECONDS = 100;
export const DEFAULT_EVERY_SECONDS = 60;

export interface SyncConfig {
  readonly every: number;
  readonly projects: readonly SyncProject[];
}

export type { SyncProject };

export type SyncConfigResult =
  | { readonly ok: true; readonly config: SyncConfig }
  | { readonly ok: false; readonly errors: readonly string[] };

/** The only keys a `sync.json` may have. Anything else is a typo worth naming. */
const CONFIG_KEYS = ["every", "projects"];

/**
 * Reads the file that says which programs this client runs and how often, or
 * every reason not to run any of them.
 *
 * The whole file is read before a single program is started, so one entry that
 * could not work fails the run rather than being discovered halfway through it:
 * a scheduled run has nobody to answer a question in the middle of, and half a
 * tick's waves are as wrong as none of them. Every error is collected rather than
 * the first, because the owner edits one file and would otherwise fix it one run
 * at a time.
 *
 * An error names the entry by its index and the key that is wrong, and never
 * quotes a value: a command line is text from a file that ends up in a launchd log
 * anyone with a shell can read. The closed objects are the contract's own rule —
 * a key this client does not know is a key it would silently drop, and a
 * misspelt `every` is a schedule nobody asked for.
 */
export function readSyncConfig(text: string): SyncConfigResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["sync.json is not JSON"] };
  }
  if (!isRecord(parsed)) {
    return {
      ok: false,
      errors: ["sync.json must be a JSON object with every and projects"],
    };
  }
  if (Object.keys(parsed).some((key) => !CONFIG_KEYS.includes(key))) {
    return {
      ok: false,
      errors: ["sync.json holds a key this client does not know"],
    };
  }
  const errors: string[] = [];
  // The period is read first because a collector's own deadline is capped by it,
  // and it is resolved to its default before anything else is judged, so one bad
  // number never produces a second refusal that only follows from it.
  const every =
    readEvery(own(parsed, "every"), errors) ?? DEFAULT_EVERY_SECONDS;
  const projects = readProjects(own(parsed, "projects"), every, errors);
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, config: { every, projects } };
}

/**
 * The period, or `undefined` while it is still being complained about.
 */
function readEvery(raw: unknown, errors: string[]): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    errors.push("every must be a whole number of seconds");
    return undefined;
  }
  if (raw < MIN_EVERY_SECONDS || raw > MAX_EVERY_SECONDS) {
    errors.push(
      `every must be between ${MIN_EVERY_SECONDS} and ${MAX_EVERY_SECONDS} seconds`,
    );
    return undefined;
  }
  return raw;
}

function readProjects(
  raw: unknown,
  every: number,
  errors: string[],
): SyncProject[] {
  if (!Array.isArray(raw)) {
    errors.push("projects must be a JSON array");
    return [];
  }
  if (raw.length === 0) {
    errors.push("projects must name at least one project");
    return [];
  }
  const projects: SyncProject[] = [];
  const seen = new Set<string>();
  for (const [index, value] of raw.entries()) {
    const read = readSyncProject(value, index, seen, every);
    for (const error of read.errors) {
      errors.push(error);
    }
    if (read.project !== undefined) {
      projects.push(read.project);
    }
  }
  return projects;
}
