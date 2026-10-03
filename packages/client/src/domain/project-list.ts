import { isProjectId } from "@hexagen-monaco/waves-contract";

import { carriesCredentials } from "./endpoint.js";
import { isRecord, own } from "./object.js";
import { readProjectRequest } from "./project-request.js";

/** One project as the owner's list holds it: the three fields a POST carries. */
export interface ProjectEntry {
  readonly id: string;
  readonly name: string;
  readonly repo?: string;
}

/**
 * How many projects one list may name, skipped ones included. It happens to be
 * the same number as the ceiling the server counts the registry by, so a list
 * that is accepted here cannot be refused there for being too long.
 */
export const MAX_PROJECT_LIST = 64;

export type ProjectList =
  | { readonly ok: true; readonly entries: readonly ProjectEntry[] }
  | { readonly ok: false; readonly errors: readonly string[] };

/** The only keys an entry may have. A list is not a place to keep anything else. */
const ENTRY_KEYS = ["id", "name", "repo"];

/**
 * The projects to register, or every reason not to register any of them.
 *
 * The whole list is read before a single request goes out, so one entry the
 * server would refuse fails the run rather than being discovered halfway
 * through it. Every error is collected rather than the first, because the owner
 * edits one file and would otherwise fix it one run at a time.
 *
 * An error names the entry by its index in the file — `entry 3` is the fourth,
 * the way the owner counts the array — and the key that is wrong. It never
 * quotes a value: a list is read from a launchd log that anyone with a shell on
 * the machine can read, and a repo URL in one may carry a password. Which is
 * also why nothing here opens the file, and why this file gets no 0600 trust
 * check: the list is the owner's own, and the secret is not in it.
 */
export function readProjectList(text: string): ProjectList {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["projects file is not JSON"] };
  }
  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      errors: ["projects file must be a JSON array of projects"],
    };
  }
  if (parsed.length > MAX_PROJECT_LIST) {
    return {
      ok: false,
      errors: [
        `projects file has ${parsed.length} entries; at most ${MAX_PROJECT_LIST} are allowed`,
      ],
    };
  }
  const errors: string[] = [];
  const entries: ProjectEntry[] = [];
  const ids = new Set<string>();
  for (const [index, value] of parsed.entries()) {
    const read = readEntry(value, index, ids);
    for (const error of read.errors) {
      errors.push(error);
    }
    if (read.entry !== undefined) {
      entries.push(read.entry);
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, entries };
}

interface EntryRead {
  readonly entry: ProjectEntry | undefined;
  readonly errors: readonly string[];
}

function readEntry(value: unknown, index: number, ids: Set<string>): EntryRead {
  if (!isRecord(value)) {
    return {
      entry: undefined,
      errors: [
        `entry ${index}: must be an object with id, name and an optional repo`,
      ],
    };
  }
  const errors: string[] = [];
  for (const key of Object.keys(value)) {
    if (!ENTRY_KEYS.includes(key)) {
      // The key is not repeated: it is text from the file, and an error here
      // goes to a log a scheduled run keeps. The index is enough to find it.
      errors.push(`entry ${index}: holds a key a project does not have`);
      break;
    }
  }
  const rawId = own(value, "id");
  const rawName = own(value, "name");
  const rawRepo = own(value, "repo");
  const id = readId(rawId, index, ids, errors);
  const name = typeof rawName === "string" ? rawName : undefined;
  if (name === undefined) {
    errors.push(`entry ${index}: name must be a string`);
  }
  const repo = typeof rawRepo === "string" ? rawRepo : undefined;
  if (rawRepo !== undefined && repo === undefined) {
    errors.push(`entry ${index}: repo must be a string`);
  }
  // The contract's own rules, through the same function `register` uses. A
  // field of the wrong type is still asked about, so one bad entry names every
  // mistake in it rather than one per run — but the answer is dropped where the
  // list has already said the same thing in its own words.
  const untyped = [
    ...(id === undefined ? ["/id"] : []),
    ...(name === undefined ? ["/name"] : []),
    ...(rawRepo !== undefined && repo === undefined ? ["/repo"] : []),
  ];
  for (const issue of readProjectRequest({
    id: id ?? "",
    name: name ?? "",
    repo,
  })) {
    if (!untyped.includes(issue.path)) {
      errors.push(`entry ${index}: ${issue.path.slice(1)}: ${issue.message}`);
    }
  }
  // The contract would store a repo URL that carries a password; the status page
  // would then render it, for everyone who looks.
  if (repo !== undefined && carriesCredentials(repo)) {
    errors.push(`entry ${index}: repo must not carry a user or a password`);
  }
  if (id === undefined || name === undefined || errors.length > 0) {
    return { entry: undefined, errors };
  }
  return { entry: { id, name, repo }, errors: [] };
}

/**
 * The id, the contract's rule applied, and the list's own: a name twice is a
 * mistake the server cannot catch, because the first one would be registered and
 * the second would come back a 409 on every run from then on.
 */
function readId(
  raw: unknown,
  index: number,
  ids: Set<string>,
  errors: string[],
): string | undefined {
  if (typeof raw !== "string") {
    errors.push(`entry ${index}: id must be a string`);
    return undefined;
  }
  if (!isProjectId(raw)) {
    errors.push(`entry ${index}: id is not a project id`);
    return undefined;
  }
  if (ids.has(raw)) {
    errors.push(`entry ${index}: id is one the list already has`);
  }
  ids.add(raw);
  return raw;
}
