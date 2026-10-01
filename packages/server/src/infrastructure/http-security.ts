import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export const CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

export const BASIC_PREFIX = "Basic ";
export const CHALLENGE = 'Basic realm="waves", charset="UTF-8"';
export const JSON_TYPE = "application/json; charset=utf-8";
export const NO_STORE = { "Cache-Control": "no-store" } as const;
export const ALLOW_GET_HEAD = { Allow: "GET, HEAD" } as const;

const BASE_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export type Headers = Readonly<Record<string, string>>;

export interface Reply {
  readonly status: number;
  readonly type: string;
  readonly body: Buffer;
}

export function jsonReply(status: number, payload: unknown): Reply {
  return {
    status,
    type: JSON_TYPE,
    body: Buffer.from(JSON.stringify(payload)),
  };
}

export function send(
  res: ServerResponse,
  reply: Reply,
  method: string,
  extra: Headers,
): number {
  res.writeHead(reply.status, {
    ...BASE_HEADERS,
    ...extra,
    "Content-Type": reply.type,
    "Content-Length": String(reply.body.byteLength),
  });
  res.end(method === "HEAD" ? undefined : reply.body);
  return reply.status;
}

export function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function presentedPassword(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (header === undefined || !header.startsWith(BASIC_PREFIX)) {
    return undefined;
  }
  const encoded = header.slice(BASIC_PREFIX.length);
  if (encoded.length % 4 !== 0 || !BASE64.test(encoded)) {
    return undefined;
  }
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator === -1) {
    return undefined;
  }
  return decoded.slice(separator + 1);
}

export function authorised(req: IncomingMessage, expected: Buffer): boolean {
  const password = presentedPassword(req);
  if (password === undefined) {
    return false;
  }
  return timingSafeEqual(sha256(password), expected);
}

export interface ParserRefusal {
  readonly status: number;
  readonly reason: string;
}

const BAD_REQUEST: ParserRefusal = { status: 400, reason: "Bad Request" };

const PARSER_REFUSALS: Readonly<Record<string, ParserRefusal>> = {
  HPE_HEADER_OVERFLOW: {
    status: 431,
    reason: "Request Header Fields Too Large",
  },
  ERR_HTTP_REQUEST_TIMEOUT: { status: 408, reason: "Request Timeout" },
};

export interface RawSocket {
  readonly writable: boolean;
  end(data: string): unknown;
  destroy(): unknown;
}

/**
 * The answer for a request Node refused before it became one: an oversized
 * header block, a request that took too long, or anything else the parser
 * rejected.
 */
export function parserRefusal(error: unknown): ParserRefusal {
  const code = String((error as NodeJS.ErrnoException).code);
  return PARSER_REFUSALS[code] ?? BAD_REQUEST;
}

/**
 * Answers a request the parser never produced. Node's own default answer would
 * carry no security headers, so the same three headers are written by hand
 * before the socket is dropped. The body is empty: nothing about the request is
 * echoed back.
 */
export function refuseParsedRequest(
  socket: RawSocket,
  refusal: ParserRefusal,
): void {
  if (socket.writable) {
    socket.end(
      [
        `HTTP/1.1 ${refusal.status} ${refusal.reason}`,
        `Content-Security-Policy: ${CONTENT_SECURITY_POLICY}`,
        "X-Content-Type-Options: nosniff",
        "Referrer-Policy: no-referrer",
        "Content-Length: 0",
        "Connection: close",
        "",
        "",
      ].join("\r\n"),
    );
  }
  socket.destroy();
}
