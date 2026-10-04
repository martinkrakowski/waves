import { isProjectId } from "@hexagen-monaco/waves-contract";

import { isRecord, own } from "./object.js";

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

/** One collector's own deadline, which is also capped by half the period. */
export const MIN_TIMEOUT_SECONDS = 1;
export const MAX_TIMEOUT_SECONDS = 30;
export const MAX_DEFAULT_TIMEOUT_SECONDS = 20;

/** One project as `sync.json` holds it. */
export interface SyncProject {
  readonly project: string;
  /** The program and its arguments, spawned without a shell. */
  readonly command: readonly string[];
  readonly cwd: string;
  readonly timeoutSeconds: number;
}

export interface SyncConfig {
  readonly every: number;
  readonly projects: readonly SyncProject[];
}

export type SyncConfigResult =
  | { readonly ok: true; readonly config: SyncConfig }
  | { readonly ok: false; readonly errors: readonly string[] };

/** The only keys a `sync.json` may have. Anything else is a typo worth naming. */
const CONFIG_KEYS = ["every", "projects"];
const PROJECT_KEYS = ["project", "command", "cwd", "timeoutSeconds"];

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
  const unknown = Object.keys(parsed).filter(
    (key) => !CONFIG_KEYS.includes(key),
  );
  if (unknown.length > 0) {
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
    const read = readProject(value, index, seen, every, errors);
    if (read !== undefined) {
      projects.push(read);
    }
  }
  return projects;
}

function readProject(
  value: unknown,
  index: number,
  seen: Set<string>,
  every: number,
  errors: string[],
): SyncProject | undefined {
  if (!isRecord(value)) {
    errors.push(`project ${index}: must be an object`);
    return undefined;
  }
  const closed = Object.keys(value).filter(
    (key) => !PROJECT_KEYS.includes(key),
  );
  if (closed.length > 0) {
    errors.push(`project ${index}: holds a key this client does not know`);
    return undefined;
  }
  const project = readProjectId(own(value, "project"), index, seen, errors);
  const command = readCommand(own(value, "command"), index, errors);
  const cwd = readCwd(own(value, "cwd"), index, errors);
  const timeoutSeconds = readTimeout(
    own(value, "timeoutSeconds"),
    index,
    every,
    errors,
  );
  if (
    project === undefined ||
    command === undefined ||
    cwd === undefined ||
    timeoutSeconds === undefined
  ) {
    return undefined;
  }
  return { project, command, cwd, timeoutSeconds };
}

/**
 * The id, with the contract's rule and the file's own: a project twice would have
 * two collectors racing for the same token and the same waves, and the server's
 * one write a second would be spent answering both.
 */
function readProjectId(
  raw: unknown,
  index: number,
  seen: Set<string>,
  errors: string[],
): string | undefined {
  if (typeof raw !== "string") {
    errors.push(`project ${index}: project must be a string`);
    return undefined;
  }
  if (!isProjectId(raw)) {
    errors.push(`project ${index}: project is not a project id`);
    return undefined;
  }
  if (seen.has(raw)) {
    errors.push(`project ${index}: project is one the file already has`);
    return undefined;
  }
  seen.add(raw);
  return raw;
}

/**
 * The program and its arguments as an array. A string would be a shell command
 * line, and this client has no shell: `command[0]` is the program and everything
 * after it is an argument, so nothing in an entry is ever expanded, quoted or
 * split. An absolute `command[0]` is what makes that safe to write down, because
 * the collector's environment carries only what the file's own project needs.
 */
function readCommand(
  raw: unknown,
  index: number,
  errors: string[],
): readonly string[] | undefined {
  if (!Array.isArray(raw)) {
    errors.push(`project ${index}: command must be an array of strings`);
    return undefined;
  }
  if (!raw.every((part) => typeof part === "string")) {
    errors.push(`project ${index}: command must be an array of strings`);
    return undefined;
  }
  if (raw.length === 0) {
    errors.push(`project ${index}: command must name a program to run`);
    return undefined;
  }
  if (!isAbsolute(String(raw[0]))) {
    errors.push(`project ${index}: command[0] must be an absolute path`);
    return undefined;
  }
  return raw.map((part) => String(part));
}

function readCwd(
  raw: unknown,
  index: number,
  errors: string[],
): string | undefined {
  if (typeof raw !== "string") {
    errors.push(`project ${index}: cwd must be a string`);
    return undefined;
  }
  if (!isAbsolute(raw)) {
    errors.push(`project ${index}: cwd must be an absolute path`);
    return undefined;
  }
  return raw;
}

/**
 * One collector's deadline, which is never more than half the period: a program
 * that could take the whole tick would leave the projects after it nothing but a
 * skipped line, every tick, for ever. The default follows the same rule rather
 * than a constant, so a short period does not need a second number in the file.
 */
function readTimeout(
  raw: unknown,
  index: number,
  every: number,
  errors: string[],
): number | undefined {
  const cap = every / 2;
  if (raw === undefined) {
    return Math.min(MAX_DEFAULT_TIMEOUT_SECONDS, Math.floor(cap));
  }
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    errors.push(`project ${index}: timeoutSeconds must be a whole number`);
    return undefined;
  }
  if (raw < MIN_TIMEOUT_SECONDS || raw > MAX_TIMEOUT_SECONDS) {
    errors.push(
      `project ${index}: timeoutSeconds must be between ${MIN_TIMEOUT_SECONDS} and ${MAX_TIMEOUT_SECONDS}`,
    );
    return undefined;
  }
  if (raw > cap) {
    errors.push(
      `project ${index}: timeoutSeconds must be at most half of every (${cap})`,
    );
    return undefined;
  }
  return raw;
}

/**
 * Whether a path is absolute. There is no `node:path` in the domain, and there
 * does not need to be: a collector is spawned with no shell and no working
 * directory of its own, so the only question about a path is whether the kernel
 * would have to guess where it starts.
 */
function isAbsolute(path: string): boolean {
  return path.startsWith("/");
}
