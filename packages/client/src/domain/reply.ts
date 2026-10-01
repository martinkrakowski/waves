import { isRecord, own } from "./object.js";

/** One `{path, message}` pointer from the server, the same shape the contract uses. */
export interface ServerIssue {
  readonly path: string;
  readonly message: string;
}

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

/** The reason phrase for a status, so a failure reads like an HTTP trace. */
export function reasonPhrase(status: number): string {
  return REASON_PHRASES[status] ?? "Unexpected Status";
}

/**
 * Every pointer the server sent, whatever shape it sent it in: the
 * `{errors: [...]}` of a 422, a single `{message}` for anything else, and
 * nothing for an empty or unparsable body.
 */
export function readIssues(body: string): ServerIssue[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  if (!isRecord(parsed)) {
    return [];
  }
  const errors = own(parsed, "errors");
  if (Array.isArray(errors)) {
    return errors.flatMap(readIssue);
  }
  const message = own(parsed, "message");
  return typeof message === "string" ? [{ path: "", message }] : [];
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
  return [{ path: typeof path === "string" ? path : "", message }];
}

export function issueLines(issues: readonly ServerIssue[]): string[] {
  return issues.map((issue) =>
    issue.path === ""
      ? `  ${issue.message}`
      : `  ${issue.path}: ${issue.message}`,
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

/** The project token from a 201. It is never printed, logged or stored anywhere but the token file. */
export function readToken(body: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const token = own(parsed, "token");
  return typeof token === "string" && token !== "" ? token : undefined;
}

/** The server's timestamp from a 200, so the user can see when it landed. */
export function readReceivedAt(body: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) {
    return undefined;
  }
  const receivedAt = own(parsed, "receivedAt");
  return typeof receivedAt === "string" ? receivedAt : undefined;
}
