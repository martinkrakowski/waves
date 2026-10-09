import { isRecord, own } from "./object.js";

/** One `{path, message}` pointer from the server, the same shape the contract uses. */
export interface ServerIssue {
  readonly path: string;
  readonly message: string;
}

/**
 * How much of a server-provided string is ever printed. A message longer than
 * this is not something a user reads to the end, and an answer that long is
 * better refused than echoed.
 */
export const MAX_SERVER_TEXT = 200;

const REASON_PHRASES: Readonly<Record<number, string>> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  409: "Conflict",
  413: "Content Too Large",
  415: "Unsupported Media Type",
  422: "Unprocessable Content",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

// The bytes an escape sequence is made of. Left in an answer, they can clear
// the screen, repaint the line and hide what the client actually said.
const ESCAPE = 27;
const FINAL_BYTE_LOW = 64;
const FINAL_BYTE_HIGH = 126;
const ELLIPSIS = "…";

/**
 * The characters that render as nothing: the C0 and C1 controls, the format
 * characters (zero-width joiners, soft hyphens, the byte-order marks) and the
 * two line separators Unicode counts as spaces. Between them they can hide a
 * word, reorder one, or start a line the user never sees end.
 */
const INVISIBLE = /[\p{Cc}\p{Cf}\u2028\u2029]/u;

function isInvisible(point: string): boolean {
  return INVISIBLE.test(point);
}

/** Outside a sequence. */
const OUTSIDE = 0;
/** An escape has been seen and its bracket has not. */
const AFTER_ESCAPE = 1;
/** Inside a sequence, looking for the byte that ends it. */
const INSIDE = 2;

/**
 * A server-provided string, made safe to print, in one pass over its characters.
 *
 * Escape sequences and every character that renders as nothing become spaces,
 * and the result is capped by code point so that a character made of two code
 * units is never cut in half. The text is the server's to choose; the terminal's
 * is not.
 *
 * The walk remembers where in a sequence it is rather than re-reading the rest
 * of the text at every escape: an answer made of nothing but escape sequences
 * would otherwise cost a copy of what is left for each one, which on 64 KiB is
 * seconds of work before a single character reaches the screen.
 */
export function safeText(value: string): string {
  const points = Array.from(value);
  const cleaned: string[] = [];
  let state = OUTSIDE;
  for (const [position, point] of points.entries()) {
    const code = point.charCodeAt(0);
    if (state === INSIDE) {
      // The first byte from @ upwards is the end of the sequence.
      state =
        code >= FINAL_BYTE_LOW && code <= FINAL_BYTE_HIGH ? OUTSIDE : INSIDE;
      continue;
    }
    if (state === AFTER_ESCAPE) {
      // The bracket that opened it belongs to the sequence, not to the text.
      state = INSIDE;
      continue;
    }
    if (code === ESCAPE) {
      // Only `ESC [` opens a sequence. An escape on its own says nothing about
      // where it ends, so it is dropped by itself and the text carries on.
      state = points[position + 1] === "[" ? AFTER_ESCAPE : OUTSIDE;
      continue;
    }
    cleaned.push(isInvisible(point) ? " " : point);
  }
  const stripped = cleaned.join("").trim();
  // Counted in characters, not in code units, so that a cap of 200 is 200
  // characters of the text rather than 100 emoji.
  const kept = Array.from(stripped);
  if (kept.length <= MAX_SERVER_TEXT) {
    return stripped;
  }
  return `${kept.slice(0, MAX_SERVER_TEXT - 1).join("")}${ELLIPSIS}`;
}

/** The reason phrase for a status, so a failure reads like an HTTP trace. */
export function reasonPhrase(status: number): string {
  return REASON_PHRASES[status] ?? "Unexpected Status";
}

/**
 * Every pointer the server sent, whatever shape it sent it in: the
 * `{errors: [...]}` of a 422, the `{error}` the server sends for everything
 * else, and nothing at all for an empty or unreadable body.
 */
export function readIssues(body: string): ServerIssue[] {
  const parsed = parseObject(body);
  if (parsed === undefined) {
    return [];
  }
  const errors = own(parsed, "errors");
  if (Array.isArray(errors)) {
    return errors.flatMap(readIssue);
  }
  return readTextIssue(parsed);
}

function readIssue(value: unknown): ServerIssue[] {
  if (!isRecord(value)) {
    return [];
  }
  const message = own(value, "message");
  if (typeof message !== "string") {
    return [];
  }
  const path = own(value, "path");
  return [
    { path: typeof path === "string" ? path : "", message: safeText(message) },
  ];
}

/** `{error}` first, then `{message}`, then nothing. */
function readTextIssue(record: Record<string, unknown>): ServerIssue[] {
  for (const key of ["error", "message"]) {
    const text = own(record, key);
    if (typeof text === "string") {
      return [{ path: "", message: safeText(text) }];
    }
  }
  return [];
}

export function issueLines(issues: readonly ServerIssue[]): string[] {
  return issues.map((issue) =>
    issue.path === ""
      ? `  ${issue.message}`
      : `  ${safeText(issue.path)}: ${issue.message}`,
  );
}

/** The tail of a failure message: nothing, or the server's pointers one per line. */
export function serverFailure(body: string): string {
  const issues = readIssues(body);
  if (issues.length === 0) {
    return "";
  }
  return `\n${issueLines(issues).join("\n")}`;
}

/**
 * The project token from a 201. It is never printed, logged or stored anywhere
 * but the token file, and it is not made safe: a secret is written down exactly
 * as it arrived, not tidied up for display.
 */
export function readToken(body: string): string | undefined {
  const parsed = parseObject(body);
  if (parsed === undefined) {
    return undefined;
  }
  const token = own(parsed, "token");
  return typeof token === "string" && token !== "" ? token : undefined;
}

/** The server's timestamp from a 200, so the user can see when it landed. */
export function readReceivedAt(body: string): string | undefined {
  const parsed = parseObject(body);
  if (parsed === undefined) {
    return undefined;
  }
  const receivedAt = own(parsed, "receivedAt");
  return typeof receivedAt === "string" ? safeText(receivedAt) : undefined;
}

/** The fields a `raise` 200 answers with, or `undefined` when the body is unusable. */
export interface RaiseReply {
  readonly revision: number;
  readonly textSha256: string;
  readonly created: boolean;
  readonly entries: number;
}

/**
 * Reads a `raise` reply body the same way `readReceivedAt` does: check the shape
 * the server sent rather than trusting it. A body that is not one, or that carries
 * a field of the wrong type, is refused so the caller can fail rather than print a
 * half-read answer.
 */
export function readRaiseReply(body: string): RaiseReply | undefined {
  const parsed = parseObject(body);
  if (parsed === undefined) {
    return undefined;
  }
  const revision = own(parsed, "revision");
  const textSha256 = own(parsed, "textSha256");
  const created = own(parsed, "created");
  const entries = own(parsed, "entries");
  if (
    typeof revision !== "number" ||
    !Number.isInteger(revision) ||
    typeof textSha256 !== "string" ||
    typeof created !== "boolean" ||
    typeof entries !== "number" ||
    !Number.isInteger(entries)
  ) {
    return undefined;
  }
  return { revision, textSha256, created, entries };
}

/**
 * The text of a server-provided `error`, the single message the routes answer with
 * on a 409. Empty when the body carried none, so a caller that prints it prints a
 * blank line and never a crash.
 */
export function readServerError(body: string): string {
  const issues = readIssues(body);
  return issues.map((issue) => issue.message).join("\n");
}

/**
 * Validation issues as `<label>: <pointer>: <message>`, one per line, with `/` for
 * the root pointer. Commands whose local-validation failures are printed line by
 * line and then given a closing "did not send" line use this rather than a thrown
 * `UsageError`, so each line carries the command's own name.
 */
export function labelIssueLines(
  label: string,
  issues: readonly ServerIssue[],
): string[] {
  return issues.map((issue) => {
    const pointer = issue.path === "" ? "/" : issue.path;
    return `${label}: ${pointer}: ${issue.message}`;
  });
}

/** The `id` an event 201 answers with, or `undefined` when absent. */
export function readEventId(body: string): string | undefined {
  const parsed = parseObject(body);
  if (parsed === undefined) {
    return undefined;
  }
  const id = own(parsed, "id");
  return typeof id === "string" ? safeText(id) : undefined;
}

/** The `index` a state entry 201 answers with, or `undefined` when absent. */
export function readStateEntryIndex(body: string): number | undefined {
  const parsed = parseObject(body);
  if (parsed === undefined) {
    return undefined;
  }
  const index = own(parsed, "index");
  return typeof index === "number" && Number.isInteger(index)
    ? index
    : undefined;
}

/** The current revision, hash and entry count the server sends on a 409. */
export interface StaleReply {
  readonly revision: number;
  readonly textSha256: string;
  readonly entries: number;
}

/**
 * Reads the 409 body a state write gets when its pin moved before the request:
 * the current `revision`, `textSha256` and `entries`, so the writer knows what to
 * read again. `undefined` when the body is not one, which is a failure to read.
 */
export function readStaleReply(body: string): StaleReply | undefined {
  const parsed = parseObject(body);
  if (parsed === undefined) {
    return undefined;
  }
  const revision = own(parsed, "revision");
  const textSha256 = own(parsed, "textSha256");
  const entries = own(parsed, "entries");
  if (
    typeof revision !== "number" ||
    !Number.isInteger(revision) ||
    typeof textSha256 !== "string" ||
    typeof entries !== "number" ||
    !Number.isInteger(entries)
  ) {
    return undefined;
  }
  return { revision, textSha256, entries };
}

/**
   * The body of a `GET .../decisions/<id>`: an object holding the head's `id`,
   * plus `revisions` and `entries` arrays the caller prints verbatim. `undefined`
   * when the body is not one — a body read.ts cannot trust to name the decision,
   * it refuses rather than echo. The matched `id` is the one the request named.
   *
   * The parsed record is re-encoded with `JSON.stringify` so what is printed is
   * always one line of JSON, whatever shape the server sent the body in: a
   * pretty-printed record prints many lines otherwise.
   */
  export function readDecisionRecord(
    body: string,
    id: string,
  ): string | undefined {
    const parsed = parseObject(body);
    if (parsed === undefined) {
      return undefined;
    }
    const head = own(parsed, "head");
    if (!isRecord(head)) {
      return undefined;
    }
    if (own(head, "id") !== id) {
      return undefined;
    }
    const revisions = own(parsed, "revisions");
    const entries = own(parsed, "entries");
    if (!Array.isArray(revisions) || !Array.isArray(entries)) {
      return undefined;
    }
    return JSON.stringify(parsed);
  }

export function parseObject(body: string): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  return isRecord(parsed) ? parsed : undefined;
}
