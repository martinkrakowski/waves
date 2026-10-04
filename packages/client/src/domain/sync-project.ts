import { isProjectId } from "@hexagen-monaco/waves-contract";

import { isRecord, own } from "./object.js";

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

/** The only keys one project in the file may have. */
const PROJECT_KEYS = ["project", "command", "cwd", "timeoutSeconds"];

export interface ProjectRead {
  readonly project: SyncProject | undefined;
  readonly errors: readonly string[];
}

/**
 * One project out of the file, or every reason that one cannot be run.
 *
 * `seen` is the caller's, and an id it already holds is refused here: two entries
 * for one project would have two collectors racing for the same token and the same
 * waves, and the server's one write a second would be spent answering both.
 *
 * Every mistake in the entry is named, not just the first, because the owner edits
 * one file and would otherwise fix it one run at a time. No value from the file is
 * ever quoted: a command line is text that ends up in a launchd log anyone with a
 * shell on the machine can read.
 */
export function readSyncProject(
  value: unknown,
  index: number,
  seen: Set<string>,
  every: number,
): ProjectRead {
  if (!isRecord(value)) {
    return {
      project: undefined,
      errors: [`project ${index}: must be an object`],
    };
  }
  if (Object.keys(value).some((key) => !PROJECT_KEYS.includes(key))) {
    return {
      project: undefined,
      errors: [`project ${index}: holds a key this client does not know`],
    };
  }
  const errors: string[] = [];
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
    timeoutSeconds === undefined ||
    errors.length > 0
  ) {
    return { project: undefined, errors };
  }
  return {
    project: { project, command, cwd, timeoutSeconds },
    errors: [],
  };
}

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
 * the collector's environment carries only what its own project needs.
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
