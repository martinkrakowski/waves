import type { IncomingMessage } from "node:http";

import { describe, expect, it } from "vitest";

import {
  clientAddress,
  forwardedAddress,
  forwardedProto,
  headerValues,
  socketAddress,
} from "../src/infrastructure/client-address.js";

function request(headers: Record<string, string[]>): IncomingMessage {
  const distinct: Record<string, string[]> = {};
  for (const [name, values] of Object.entries(headers)) {
    distinct[name] = values;
  }
  return {
    headersDistinct: distinct,
    socket: { remoteAddress: "10.1.2.3" },
  } as unknown as IncomingMessage;
}

describe("forwardedAddress", () => {
  it("takes the last entry of the chain", () => {
    expect(forwardedAddress("10.0.0.1, 203.0.113.7", "10.1.2.3")).toBe(
      "203.0.113.7",
    );
    expect(forwardedAddress(" 203.0.113.7 ", "10.1.2.3")).toBe("203.0.113.7");
  });

  it("falls back to the socket when there is no usable entry", () => {
    expect(forwardedAddress(undefined, "10.1.2.3")).toBe("10.1.2.3");
    expect(forwardedAddress("", "10.1.2.3")).toBe("10.1.2.3");
    expect(forwardedAddress(" , , ", "10.1.2.3")).toBe("10.1.2.3");
  });
});

describe("socketAddress", () => {
  it("is the peer, or an empty name when there is none", () => {
    expect(socketAddress({ remoteAddress: "127.0.0.1" })).toBe("127.0.0.1");
    expect(socketAddress({})).toBe("");
  });
});

describe("headerValues", () => {
  it("joins every value the client sent, and says so when there were none", () => {
    const req = request({ "x-forwarded-for": ["10.0.0.1", "203.0.113.7"] });

    expect(headerValues(req, "x-forwarded-for")).toBe("10.0.0.1, 203.0.113.7");
    expect(headerValues(req, "x-forwarded-proto")).toBeUndefined();
  });
});

describe("forwardedProto", () => {
  it("is the reported scheme, trimmed and lower cased", () => {
    expect(forwardedProto(request({ "x-forwarded-proto": [" HTTPS "] }))).toBe(
      "https",
    );
    expect(forwardedProto(request({ "x-forwarded-proto": ["HTTP"] }))).toBe(
      "http",
    );
    expect(
      forwardedProto(request({ "x-forwarded-proto": ["https", "http"] })),
    ).toBe("https,http");
  });

  it("is nothing at all when the proxy reported no scheme", () => {
    expect(forwardedProto(request({}))).toBeUndefined();
  });
});

describe("clientAddress", () => {
  it("is the last forwarded entry only when the proxy is trusted", () => {
    const req = request({ "x-forwarded-for": ["10.0.0.1, 203.0.113.7"] });

    expect(clientAddress(req, true)).toBe("203.0.113.7");
    expect(clientAddress(req, false)).toBe("10.1.2.3");
    expect(clientAddress(request({}), true)).toBe("10.1.2.3");
  });
});
