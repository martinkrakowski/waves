import { describe, expect, it } from "vitest";

import {
  parserRefusal,
  refuseParsedRequest,
  type RawSocket,
} from "../src/infrastructure/http-security.js";

class FakeSocket implements RawSocket {
  readonly written: string[] = [];
  destroyed = 0;

  constructor(readonly writable: boolean) {}

  end(data: string): void {
    this.written.push(data);
  }

  destroy(): void {
    this.destroyed += 1;
  }
}

function withCode(code: string): Error {
  return Object.assign(new Error(code), { code });
}

describe("parserRefusal", () => {
  it.each([
    ["HPE_HEADER_OVERFLOW", 431, "Request Header Fields Too Large"],
    ["ERR_HTTP_REQUEST_TIMEOUT", 408, "Request Timeout"],
  ])("answers %s with %i", (code, status, reason) => {
    expect(parserRefusal(withCode(code))).toEqual({ status, reason });
  });

  it.each([
    ["a parse error", withCode("HPE_INVALID_METHOD")],
    ["an error without a code", new Error("unknown")],
  ])("answers %s with 400", (_label, error) => {
    expect(parserRefusal(error)).toEqual({
      status: 400,
      reason: "Bad Request",
    });
  });
});

describe("refuseParsedRequest", () => {
  it("writes the security headers and closes the connection", () => {
    const socket = new FakeSocket(true);

    refuseParsedRequest(socket, {
      status: 431,
      reason: "Request Header Fields Too Large",
    });

    expect(socket.written.join("")).toContain(
      "HTTP/1.1 431 Request Header Fields Too Large",
    );
    expect(socket.written[0]).toContain(
      "Content-Security-Policy: default-src 'none';",
    );
    expect(socket.written[0]).toContain("X-Content-Type-Options: nosniff");
    expect(socket.written[0]).toContain("Referrer-Policy: no-referrer");
    expect(socket.written[0]).toContain("Connection: close");
    expect(socket.written[0]?.endsWith("\r\n\r\n")).toBe(true);
    expect(socket.destroyed).toBe(1);
  });

  it("drops a socket that cannot be written to", () => {
    const socket = new FakeSocket(false);

    refuseParsedRequest(socket, { status: 400, reason: "Bad Request" });

    expect(socket.written).toEqual([]);
    expect(socket.destroyed).toBe(1);
  });
});
