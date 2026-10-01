import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";

import type { HttpRequest } from "../src/application/ports.js";
import {
  buildOptions,
  createTransport,
  MAX_BODY_BYTES,
  REQUEST_TIMEOUT_MS,
} from "../src/infrastructure/transport.js";

/** A request object that is only as much of one as the transport touches. */
class FakeRequest extends EventEmitter {
  readonly bodies: (string | undefined)[] = [];
  destroyed = false;
  timeoutMs: number | undefined;
  onTimeout: (() => void) | undefined;

  setTimeout(ms: number, onTimeout: () => void): this {
    this.timeoutMs = ms;
    this.onTimeout = onTimeout;
    return this;
  }

  destroy(): void {
    this.destroyed = true;
  }

  end(body?: string): void {
    this.bodies.push(body);
  }
}

/** A response object that is only as much of one as the transport reads. */
class FakeResponse extends EventEmitter {
  destroyed = false;

  constructor(
    readonly statusCode: number | undefined,
    private readonly chunks: readonly Buffer[],
    readonly headers: Record<string, string | string[] | undefined>,
  ) {
    super();
  }

  answer(): void {
    for (const chunk of this.chunks) {
      this.emit("data", chunk);
    }
    this.emit("end");
  }

  destroy(): void {
    this.destroyed = true;
  }
}

type Starter = Parameters<typeof createTransport>[1];

/** A peer that answers once the transport has attached its listeners. */
function answering(
  response: FakeResponse,
  peer: FakeRequest = new FakeRequest(),
): Starter {
  return (_options, callback) => {
    queueMicrotask(() => {
      callback(response as unknown as IncomingMessage);
      response.answer();
    });
    return peer as unknown as ClientRequest;
  };
}

function request(overrides: Partial<HttpRequest> = {}): HttpRequest {
  return {
    method: "PUT",
    url: "https://waves.example.com/api/v1/projects/waves-demo/waves/wv5",
    bearer: "project-token",
    body: '{"lanes":[]}',
    ...overrides,
  };
}

describe("buildOptions", () => {
  const url = new URL(
    "https://waves.example.com:8443/api/v1/projects?rotate=1",
  );

  it("verifies TLS, and pins the authority when one was configured", () => {
    expect(
      buildOptions(url, "POST", "admin-token", '{"id":"a"}', "PEM"),
    ).toMatchObject({ rejectUnauthorized: true, ca: "PEM" });
  });

  it("leaves the system store in charge when no authority was configured", () => {
    const options = buildOptions(url, "POST", "admin-token", "{}", undefined);
    expect(options.ca).toBeUndefined();
    expect(options.rejectUnauthorized).toBe(true);
  });

  it("describes the request, and sends no Origin", () => {
    const options = buildOptions(
      url,
      "POST",
      "admin-token",
      '{"id":"a"}',
      undefined,
    );
    expect(options.protocol).toBe("https:");
    expect(options.method).toBe("POST");
    expect(options.hostname).toBe("waves.example.com");
    expect(options.port).toBe(8443);
    expect(options.path).toBe("/api/v1/projects?rotate=1");
    expect(options.headers).toEqual({
      accept: "application/json",
      authorization: "Bearer admin-token",
      "content-type": "application/json",
      "content-length": "10",
    });
    expect(Object.keys(options.headers ?? {})).not.toContain("origin");
  });

  it("sends no body, and so no type or length, for a deletion", () => {
    expect(
      buildOptions(url, "DELETE", "project-token", undefined, undefined)
        .headers,
    ).toEqual({
      accept: "application/json",
      authorization: "Bearer project-token",
    });
  });

  it("unwraps a bracketed IPv6 host and defaults the port", () => {
    expect(
      buildOptions(
        new URL("http://[::1]/api/v1/projects"),
        "POST",
        "t",
        undefined,
        undefined,
      ),
    ).toMatchObject({ hostname: "::1", port: undefined, protocol: "http:" });
  });

  it("has no TLS option at all over plain http", () => {
    const options = buildOptions(
      new URL("http://127.0.0.1:8080/api/v1/projects"),
      "POST",
      "t",
      "{}",
      undefined,
    );
    expect(Object.hasOwn(options, "rejectUnauthorized")).toBe(false);
  });
});

describe("createTransport", () => {
  it("answers with the status, the headers and the body of a reply", async () => {
    const transport = createTransport(
      { origin: "https://waves.example.com" },
      answering(
        new FakeResponse(
          200,
          [Buffer.from('{"received'), Buffer.from('At":1}')],
          {
            "content-type": "application/json",
            "set-cookie": ["a=1", "b=2"],
            date: undefined,
          },
        ),
      ),
    );
    expect(await transport.send(request())).toEqual({
      kind: "reply",
      reply: {
        status: 200,
        headers: {
          "content-type": "application/json",
          "set-cookie": "a=1, b=2",
        },
        body: '{"receivedAt":1}',
      },
    });
  });

  it("announces an insecurely allowed host on every request", async () => {
    let warnings = 0;
    const transport = createTransport(
      {
        origin: "http://10.0.0.4:8080",
        warnInsecure: () => {
          warnings += 1;
        },
      },
      answering(new FakeResponse(204, [], {})),
    );
    const insecure = request({
      url: "http://10.0.0.4:8080/api/v1/projects",
    });
    await transport.send(insecure);
    await transport.send(insecure);
    expect(warnings).toBe(2);
  });

  it("says nothing when there is no warning to give", async () => {
    const transport = createTransport(
      { origin: "http://127.0.0.1:8080" },
      answering(new FakeResponse(200, [Buffer.from("{}")], {})),
    );
    expect(
      await transport.send(
        request({ url: "http://127.0.0.1:8080/api/v1/projects" }),
      ),
    ).toMatchObject({ kind: "reply" });
  });

  it("reports a socket error as an answer that never came", async () => {
    const peer = new FakeRequest();
    const transport = createTransport(
      { origin: "https://waves.example.com" },
      () => {
        queueMicrotask(() => {
          peer.emit("error", new Error("connect ECONNREFUSED"));
        });
        return peer as unknown as ClientRequest;
      },
    );
    expect(await transport.send(request())).toEqual({
      kind: "network",
      message: "connect ECONNREFUSED",
    });
  });

  it("reports a failure to even start the request", async () => {
    const transport = createTransport(
      { origin: "https://waves.example.com" },
      () => {
        throw new Error("the socket is gone");
      },
    );
    expect(await transport.send(request())).toEqual({
      kind: "network",
      message: "the socket is gone",
    });
  });

  it("reports anything thrown that is not an error", async () => {
    const transport = createTransport(
      { origin: "https://waves.example.com" },
      () => {
        throw "plain text";
      },
    );
    expect(await transport.send(request())).toEqual({
      kind: "network",
      message: "plain text",
    });
  });

  it("gives up after ten seconds without an answer, and drops the socket", async () => {
    const peer = new FakeRequest();
    const transport = createTransport(
      { origin: "https://waves.example.com" },
      () => {
        queueMicrotask(() => {
          peer.onTimeout?.();
        });
        return peer as unknown as ClientRequest;
      },
    );
    expect(await transport.send(request())).toEqual({
      kind: "network",
      message: `no answer within ${REQUEST_TIMEOUT_MS} ms`,
    });
    expect(peer.destroyed).toBe(true);
  });

  it("refuses an answer larger than 64 KiB, whatever arrives afterwards", async () => {
    const response = new FakeResponse(
      200,
      [Buffer.alloc(MAX_BODY_BYTES), Buffer.alloc(8), Buffer.alloc(8)],
      {},
    );
    const transport = createTransport(
      { origin: "https://waves.example.com" },
      answering(response),
    );
    expect(await transport.send(request())).toEqual({
      kind: "network",
      message: `the answer is larger than ${MAX_BODY_BYTES} bytes`,
    });
    expect(response.destroyed).toBe(true);
  });

  it("reports a response that failed mid-stream", async () => {
    const response = new FakeResponse(200, [], {});
    const transport = createTransport(
      { origin: "https://waves.example.com" },
      (_options, callback) => {
        callback(response as unknown as IncomingMessage);
        response.emit("error", new Error("the connection reset"));
        return new FakeRequest() as unknown as ClientRequest;
      },
    );
    expect(await transport.send(request())).toEqual({
      kind: "network",
      message: "the connection reset",
    });
  });

  it("takes the first answer and ignores the rest", async () => {
    const response = new FakeResponse(204, [], {});
    const transport = createTransport(
      { origin: "https://waves.example.com" },
      (_options, callback) => {
        queueMicrotask(() => {
          callback(response as unknown as IncomingMessage);
          response.emit("end");
          response.emit("error", new Error("too late"));
        });
        return new FakeRequest() as unknown as ClientRequest;
      },
    );
    expect(
      await transport.send(request({ method: "DELETE", body: undefined })),
    ).toEqual({ kind: "reply", reply: { status: 204, headers: {}, body: "" } });
  });

  it("has no status to report when the peer sends none", async () => {
    const transport = createTransport(
      { origin: "https://waves.example.com" },
      answering(new FakeResponse(undefined, [], {})),
    );
    expect(await transport.send(request())).toMatchObject({
      kind: "reply",
      reply: { status: 0 },
    });
  });

  it("picks Node's own client for the protocol of the origin", () => {
    expect(
      createTransport({ origin: "https://waves.example.com" }).send,
    ).toBeTypeOf("function");
    expect(createTransport({ origin: "http://127.0.0.1:1" }).send).toBeTypeOf(
      "function",
    );
  });

  it("ends the request with the body it was given, under a ten second timeout", async () => {
    const peer = new FakeRequest();
    const transport = createTransport(
      { origin: "https://waves.example.com" },
      answering(new FakeResponse(200, [], {}), peer),
    );
    await transport.send(request());
    expect(peer.bodies).toEqual(['{"lanes":[]}']);
    expect(peer.timeoutMs).toBe(REQUEST_TIMEOUT_MS);
  });
});
