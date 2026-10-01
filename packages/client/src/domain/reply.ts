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
const BRACKET = 91;
const FINAL_BYTE_LOW = 64;
const FINAL_BYTE_HIGH = 126;
const DELETE = 127;
const LAST_C1 = 159;
const ELLIPSIS = "…";

function isControl(code: number): boolean {
  return code <= 31 || (code >= DELETE && code <= LAST_C1);
}

/** The index of the last byte of the escape sequence at `index`, or `index` itself. */
function skipEscape(value: string, index: number): number {
  if (value.charCodeAt(index + 1) !== BRACKET) {
    return index;
  }
  let cursor = index + 2;
  while (cursor < value.length) {
    const code = value.charCodeAt(cursor);
    cursor += 1;
    if (code >= FINAL_BYTE_LOW && code <= FINAL_BYTE_HIGH) {
      return cursor - 1;
    }
  }
  // An unfinished sequence swallows the rest of the text: there is no way to
  // know where it was meant to end, so none of it can be trusted.
  return value.length - 1;
}

/**
 * A server-provided string, made safe to print. Escape sequences are removed,
 * the remaining controls become spaces so that nothing can forge the shape of
 * the output, and the result is capped: the text is the server's to choose, the
 * terminal's is not.
 */
export function safeText(value: string): string {
  let cleaned = "";
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === ESCAPE) {
      index = skipEscape(value, index);
      continue;
    }
    cleaned += isControl(value.charCodeAt(index)) ? " " : value.charAt(index);
  }
  const stripped = cleaned.trim();
  if (stripped.length <= MAX_SERVER_TEXT) {
    return stripped;
  }
  return `${stripped.slice(0, MAX_SERVER_TEXT - 1)}${ELLIPSIS}`;
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
