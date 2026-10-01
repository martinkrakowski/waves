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

/** The index of the last code point of the escape sequence at `index`. */
function skipEscape(points: readonly string[], index: number): number {
  if (points[index + 1] !== "[") {
    return index;
  }
  const rest = points.slice(index + 2);
  const end = rest.findIndex((point) => {
    const code = point.charCodeAt(0);
    return code >= FINAL_BYTE_LOW && code <= FINAL_BYTE_HIGH;
  });
  // An unfinished sequence swallows the rest of the text: there is no way to
  // know where it was meant to end, so none of it can be trusted.
  return end === -1 ? points.length - 1 : index + 2 + end;
}

/**
 * A server-provided string, made safe to print. Escape sequences and every
 * character that renders as nothing become spaces, and the result is capped by
 * code point so that a character made of two code units is never cut in half.
 * The text is the server's to choose; the terminal's is not.
 */
export function safeText(value: string): string {
  const points = Array.from(value);
  const cleaned: string[] = [];
  let index = 0;
  for (const [position, point] of points.entries()) {
    if (position < index) {
      // Already inside a sequence that has been dropped.
      continue;
    }
    if (point.charCodeAt(0) === ESCAPE) {
      // The sequence owns everything up to and including the point it ends on.
      index = skipEscape(points, position) + 1;
      continue;
    }
    cleaned.push(isInvisible(point) ? " " : point);
    index = position + 1;
  }
  const stripped = cleaned.join("").trim();
  if (stripped.length <= MAX_SERVER_TEXT) {
    return stripped;
  }
  const kept = Array.from(stripped).slice(0, MAX_SERVER_TEXT - 1);
  return `${kept.join("")}${ELLIPSIS}`;
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

function parseObject(body: string): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  return isRecord(parsed) ? parsed : undefined;
}
