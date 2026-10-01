import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";

export const CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

export const BASIC_PREFIX = "Basic ";
export const CHALLENGE = 'Basic realm="waves", charset="UTF-8"';
export const JSON_TYPE = "application/json; charset=utf-8";
export const JSON_MEDIA = "application/json";
export const NO_STORE = { "Cache-Control": "no-store" } as const;

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

/**
 * A 204 has no body and says so by not carrying a body or its type at all.
 */
export const NO_CONTENT: Reply = {
  status: 204,
  type: JSON_TYPE,
  body: Buffer.alloc(0),
};

export interface SendOptions {
  readonly method: string;
  readonly extra?: Headers;
  /**
   * When given, the answer declares `Connection: close` and ends this socket
   * once it has flushed. It is how a refusal that arrives before the request
   * body was read ends the connection, so Node never has to drain a body nobody
   * is going to read.
   *
   * The socket is ended rather than destroyed, and dropped a second later: a
   * client may still be sending a body it did not expect to be refused, and a
   * reset before it has read the answer is what turns a readable 401 into an
   * EPIPE. The timer is unref'd, so a process shutting down is not held up by it.
   */
  readonly socket?: Socket;
}

const RESET_AFTER_FLUSH_MS = 1_000;

export function send(
  res: ServerResponse,
  reply: Reply,
  options: SendOptions,
): number {
  const socket = options.socket;
  if (socket !== undefined) {
    // Stop reading before the answer goes out: what is left of the body has no
    // reader, and a socket that is being closed politely would otherwise keep
    // pulling it in for as long as the client keeps sending.
    socket.pause();
  }
  res.writeHead(reply.status, {
    ...BASE_HEADERS,
    ...(socket === undefined ? {} : { Connection: "close" }),
    ...options.extra,
    ...(reply.status === 204
      ? {}
      : {
          "Content-Type": reply.type,
          "Content-Length": String(reply.body.byteLength),
        }),
  });
  res.end(options.method === "HEAD" ? undefined : reply.body, () => {
    if (socket === undefined) {
      return;
    }
    socket.end();
    const reset = setTimeout(() => {
      socket.destroy();
    }, RESET_AFTER_FLUSH_MS);
    reset.unref();
  });
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
