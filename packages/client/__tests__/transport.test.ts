import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HttpRequest } from "../src/application/ports.js";
import {
  CONTINUE_WAIT_MS,
  buildOptions,
  createTransport,
  MAX_BODY_BYTES,
  REQUEST_TIMEOUT_MS,
} from "../src/infrastructure/transport.js";

/** A request object that is only as much of one as the transport touches. */
class FakeRequest extends EventEmitter {
  readonly bodies: (string | undefined)[] = [];
  readonly flushed: number[] = [];
  destroyed = false;

  end(body?: string): void {
    this.bodies.push(body);
  }

  flushHeaders(): void {
    this.flushed.push(this.bodies.length);
  }

  destroy(): void {
    this.destroyed = true;
  }
}

/** A response object that is only as much of one as the transport reads. */
class FakeResponse extends EventEmitter {
  destroyed = false;

  constructor(
    readonly statusCode: number | undefined,
    private readonly chunks: readonly Buffer[],
    readonly headers: Record<string, string | string[] | undefined> = {},
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

type Starter = NonNullable<Parameters<typeof createTransport>[1]>;
type Callback = Parameters<Starter>[1];

const CLOSED = 38471;

afterEach(() => {
  vi.useRealTimers();
});

function request(overrides: Partial<HttpRequest> = {}): HttpRequest {
  return {
    method: "PUT",
    url: "https://waves.example.com/api/v1/projects/waves-demo/waves/wv5",
    bearer: "project-t0ken",
    body: '{"lanes":[]}',
    ...overrides,
  };
}

/** A peer that behaves the way the exchange needs to be driven. */
interface Peer {
  readonly start: Starter;
  readonly peer: FakeRequest;
  /** The response the peer will hand over once the headers are out. */
  respond(response: FakeResponse): void;
  /** A response that arrives and then finishes on its own. */
  respondWith(response: FakeResponse): void;
}

function peer(): Peer {
  const fake = new FakeRequest();
  let callback: Callback | undefined;
  let answer: (() => void) | undefined;
  const start: Starter = (_options, received) => {
    callback = received;
    queueMicrotask(() => {
      answer?.();
    });
    return fake as unknown as ClientRequest;
  };
  const respond = (response: FakeResponse, finish: boolean): void => {
    answer = () => {
      callback?.(response as unknown as IncomingMessage);
      if (finish) {
        response.answer();
      }
    };
  };
  return {
    start,
    peer: fake,
    respond: (response) => {
      respond(response, false);
    },
    respondWith: (response) => {
      respond(response, true);
    },
  };
}

/** A peer that takes the headers and then says nothing at all. */
function deafPeer(): Peer {
  const fake = new FakeRequest();
  return {
    start: () => fake as unknown as ClientRequest,
    peer: fake,
    respond: () => undefined,
    respondWith: () => undefined,
  };
}

/** A transport over a scripted peer, with a deadline that never fires. */
function transportOver(scripted: Peer, origin = "https://waves.example.com") {
  return createTransport(
    { origin },
    scripted.start,
    () => new AbortController().signal,
  );
}

describe("buildOptions", () => {
  const url = new URL(
    "https://waves.example.com:8443/api/v1/projects?rotate=1",
  );
  const deadline = new AbortController().signal;

  it("verifies TLS, and pins the authority when one was configured", () => {
    expect(
      buildOptions(url, "POST", "admin-t0ken", '{"id":"a"}', "PEM", deadline),
    ).toMatchObject({ rejectUnauthorized: true, ca: "PEM" });
  });

  it("leaves the system store in charge when no authority was configured", () => {
    const options = buildOptions(
      url,
      "POST",
      "admin-t0ken",
      "{}",
      undefined,
      deadline,
    );
    expect(options.ca).toBeUndefined();
    expect(options.rejectUnauthorized).toBe(true);
  });

  it("bounds the request in wall-clock time", () => {
    expect(
      buildOptions(url, "DELETE", "t", undefined, undefined, deadline).signal,
    ).toBe(deadline);
  });

  it("describes the request, and sends no Origin", () => {
    const options = buildOptions(
      url,
      "POST",
      "admin-t0ken",
      '{"id":"a"}',
      undefined,
      deadline,
    );
    expect(options.protocol).toBe("https:");
    expect(options.method).toBe("POST");
    expect(options.hostname).toBe("waves.example.com");
    expect(options.port).toBe(8443);
    expect(options.path).toBe("/api/v1/projects?rotate=1");
    expect(options.headers).toEqual({
      accept: "application/json",
      authorization: "Bearer admin-t0ken",
      "content-type": "application/json",
      "content-length": "10",
      expect: "100-continue",
    });
    expect(Object.keys(options.headers ?? {})).not.toContain("origin");
  });

  it("sends no body, no type and no expectation for a deletion", () => {
    expect(
      buildOptions(url, "DELETE", "t", undefined, undefined, deadline).headers,
    ).toEqual({
      accept: "application/json",
      authorization: "Bearer t",
    });
  });

  it("sends no authorization header for a GET without a bearer", () => {
    expect(
      buildOptions(url, "GET", undefined, undefined, undefined, deadline)
        .headers,
    ).toEqual({
      accept: "application/json",
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
        deadline,
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
      deadline,
    );
    expect(Object.hasOwn(options, "rejectUnauthorized")).toBe(false);
  });
});

describe("the expectation, and the body that waits for it", () => {
  it("writes the body once the server has agreed to take it", async () => {
    const scripted = peer();
    scripted.respondWith(new FakeResponse(200, [Buffer.from("{}")]));
    const transport = transportOver(scripted);

    const pending = transport.send(request());
    expect(scripted.peer.flushed).toHaveLength(1);
    expect(scripted.peer.bodies).toEqual([]);

    scripted.peer.emit("continue");
    expect(scripted.peer.bodies).toEqual(['{"lanes":[]}']);

    expect(await pending).toMatchObject({ kind: "reply" });
  });

  it("writes the body anyway when the server never answers the expectation", async () => {
    // The wait is a second of the client's own clock, so it is taken from a
    // fake one rather than spent.
    vi.useFakeTimers();
    const scripted = deafPeer();
    const transport = transportOver(scripted);

    const pending = transport.send(request());
    expect(scripted.peer.flushed).toHaveLength(1);
    expect(scripted.peer.bodies).toEqual([]);

    await vi.advanceTimersByTimeAsync(CONTINUE_WAIT_MS);
    expect(scripted.peer.bodies).toEqual(['{"lanes":[]}']);

    // A late agreement does not send it a second time.
    scripted.peer.emit("continue");
    expect(scripted.peer.bodies).toEqual(['{"lanes":[]}']);

    // And the exchange is settled rather than left hanging on its deadline.
    scripted.peer.emit("error", new Error("the socket went away"));
    expect(await pending).toEqual({
      kind: "network",
      message: "the socket went away",
      beforeBody: false,
    });
    vi.useRealTimers();
  });

  it("never writes the body when the answer arrives first", async () => {
    const scripted = peer();
    scripted.respondWith(
      new FakeResponse(401, [Buffer.from('{"error":"refused"}')]),
    );
    const transport = transportOver(scripted);

    const outcome = await transport.send(request());

    expect(outcome).toEqual({
      kind: "reply",
      reply: {
        status: 401,
        headers: {},
        body: '{"error":"refused"}',
      },
    });
    expect(scripted.peer.bodies).toEqual([]);
    expect(scripted.peer.destroyed).toBe(true);
  });

  it("answers with the status, the headers and the body of a reply", async () => {
    const scripted = peer();
    scripted.respondWith(
      new FakeResponse(
        200,
        [Buffer.from('{"received'), Buffer.from('At":1}')],
        {
          "content-type": "application/json",
          "set-cookie": ["a=1", "b=2"],
          date: undefined,
        },
      ),
    );
    const transport = transportOver(scripted);

    const pending = transport.send(request());
    scripted.peer.emit("continue");
    expect(await pending).toEqual({
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

  it("sends a deletion with no body and no waiting", async () => {
    const scripted = peer();
    scripted.respondWith(new FakeResponse(204, [], {}));
    const transport = transportOver(scripted);

    const pending = transport.send(
      request({ method: "DELETE", body: undefined }),
    );
    expect(scripted.peer.bodies).toEqual([undefined]);
    expect(scripted.peer.flushed).toEqual([]);
    expect(await pending).toMatchObject({ kind: "reply" });
  });
});

describe("a status that arrived is a verdict", () => {
  it("keeps a refusal whose body was cut short, and does not retry it", async () => {
    const response = new FakeResponse(401, [], {
      "www-authenticate": 'Bearer realm="waves"',
      "x-note": "one",
    });
    const scripted = peer();
    scripted.respond(response);
    const transport = transportOver(scripted);

    const pending = transport.send(request());
    scripted.peer.emit("continue");
    await Promise.resolve();
    response.emit("data", Buffer.from('{"error":"the project'));
    scripted.peer.emit("error", new Error("read ECONNRESET"));

    // The headers arrived with the status, so a challenge or a Retry-After is
    // still there after the connection died.
    expect(await pending).toEqual({
      kind: "reply",
      reply: {
        status: 401,
        headers: {
          "www-authenticate": 'Bearer realm="waves"',
          "x-note": "one",
        },
        body: '{"error":"the project',
      },
    });
  });

  it("keeps the headers of a throttled reply whose body was cut short", async () => {
    const response = new FakeResponse(429, [], { "retry-after": "2" });
    const scripted = peer();
    scripted.respond(response);
    const transport = transportOver(scripted);

    const pending = transport.send(request());
    await Promise.resolve();
    response.emit("data", Buffer.from('{"error":"slow'));
    scripted.peer.emit("error", new Error("read ECONNRESET"));

    expect(await pending).toEqual({
      kind: "reply",
      reply: {
        status: 429,
        headers: { "retry-after": "2" },
        body: '{"error":"slow',
      },
    });
  });

  it("keeps a refusal whose response stream failed", async () => {
    const response = new FakeResponse(422, [], {});
    const scripted = peer();
    scripted.respond(response);
    const transport = transportOver(scripted);

    const pending = transport.send(request());
    scripted.peer.emit("continue");
    await Promise.resolve();
    response.emit("error", new Error("aborted"));

    expect(await pending).toMatchObject({
      kind: "reply",
      reply: { status: 422 },
    });
  });

  it("treats a success whose body was cut short as unanswered", async () => {
    const response = new FakeResponse(200, []);
    const scripted = peer();
    scripted.respond(response);
    const transport = transportOver(scripted);

    const pending = transport.send(request());
    scripted.peer.emit("continue");
    await Promise.resolve();
    response.emit("data", Buffer.from('{"received'));
    scripted.peer.emit("error", new Error("read ECONNRESET"));

    expect(await pending).toEqual({
      kind: "network",
      message: "read ECONNRESET",
      beforeBody: false,
    });
  });
});

describe("a socket that never answers", () => {
  it("reports a failure before the body was written as one that may be repeated", async () => {
    const scripted = peer();
    scripted.respondWith(new FakeResponse(200, []));
    const transport = transportOver(scripted);

    const pending = transport.send(request());
    scripted.peer.emit("error", new Error("write EPIPE"));

    expect(await pending).toEqual({
      kind: "network",
      message: "write EPIPE",
      beforeBody: true,
    });
    expect(scripted.peer.bodies).toEqual([]);
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
      beforeBody: true,
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
      beforeBody: true,
    });
  });

  it("gives up when the deadline passes, whatever the socket was doing", async () => {
    const scripted = peer();
    scripted.respondWith(new FakeResponse(200, []));
    const controller = new AbortController();
    const transport = createTransport(
      { origin: "https://waves.example.com" },
      scripted.start,
      () => controller.signal,
    );

    const pending = transport.send(request());
    controller.abort();

    expect(await pending).toEqual({
      kind: "network",
      message: `no answer within ${REQUEST_TIMEOUT_MS} ms`,
      beforeBody: true,
    });
    expect(scripted.peer.destroyed).toBe(true);
  });

  it("reports a response that failed mid-stream after the body was sent", async () => {
    const response = new FakeResponse(200, [], {});
    const scripted = peer();
    scripted.respond(response);
    const transport = transportOver(scripted);

    const pending = transport.send(request());
    scripted.peer.emit("continue");
    await Promise.resolve();
    response.emit("error", new Error("the connection reset"));

    expect(await pending).toEqual({
      kind: "network",
      message: "the connection reset",
      beforeBody: false,
    });
  });
});

describe("the body of an answer", () => {
  it("refuses one larger than 64 KiB, and takes the first answer only", async () => {
    const response = new FakeResponse(
      200,
      [Buffer.alloc(MAX_BODY_BYTES), Buffer.alloc(8), Buffer.alloc(8)],
      {},
    );
    const scripted = peer();
    scripted.respondWith(response);
    const transport = transportOver(scripted);

    const pending = transport.send(request());
    scripted.peer.emit("continue");
    expect(await pending).toEqual({
      kind: "network",
      message: `the answer is larger than ${MAX_BODY_BYTES} bytes`,
      beforeBody: false,
    });
    expect(response.destroyed).toBe(true);

    response.emit("end");
    response.emit("error", new Error("too late"));
    expect(scripted.peer.destroyed).toBe(false);
  });

  it("keeps a refusal whose explanation is larger than 64 KiB", async () => {
    const response = new FakeResponse(
      413,
      [Buffer.alloc(MAX_BODY_BYTES + 1)],
      {},
    );
    const scripted = peer();
    scripted.respondWith(response);
    const transport = transportOver(scripted);

    const pending = transport.send(request());
    expect(await pending).toMatchObject({
      kind: "reply",
      reply: { status: 413 },
    });
  });

  it("has no status to report when the peer sends none", async () => {
    const scripted = peer();
    scripted.respondWith(new FakeResponse(undefined, [], {}));
    const transport = transportOver(scripted);

    const pending = transport.send(request());
    scripted.peer.emit("continue");
    expect(await pending).toMatchObject({
      kind: "reply",
      reply: { status: 0 },
    });
  });
});

describe("the transport of a run", () => {
  it("announces an insecurely allowed host on every request", async () => {
    let warnings = 0;
    const scripted = peer();
    scripted.respondWith(new FakeResponse(204, [], {}));
    const transport = createTransport(
      {
        origin: "http://10.0.0.4:8080",
        warnInsecure: () => {
          warnings += 1;
        },
      },
      scripted.start,
    );
    const insecure = request({
      method: "DELETE",
      body: undefined,
      url: "http://10.0.0.4:8080/api/v1/projects/waves-demo/waves/wv5",
    });
    await transport.send(insecure);
    await transport.send(insecure);
    expect(warnings).toBe(2);
  });

  it("says nothing when there is no warning to give", async () => {
    const scripted = peer();
    scripted.respondWith(new FakeResponse(200, [Buffer.from("{}")], {}));
    const transport = transportOver(scripted, "http://127.0.0.1:8080");

    expect(
      await transport.send(
        request({ url: "http://127.0.0.1:8080/api/v1/projects" }),
      ),
    ).toMatchObject({ kind: "reply" });
  });

  it("sends a GET with no authorization header and no body", async () => {
    const scripted = peer();
    scripted.respondWith(new FakeResponse(200, [Buffer.from("{}")], {}));
    const transport = transportOver(scripted);

    const pending = transport.send({
      method: "GET",
      url: "http://127.0.0.1:8080/api/v1/projects/waves-demo/decisions/d1",
    });
    expect(scripted.peer.flushed).toHaveLength(0);
    expect(scripted.peer.bodies).toEqual([undefined]);
    expect(await pending).toMatchObject({ kind: "reply" });
  });

  it("uses Node's own client, which refuses a closed port on either protocol", async () => {
    for (const origin of [
      `http://127.0.0.1:${CLOSED}`,
      `https://127.0.0.1:${CLOSED}`,
    ]) {
      const outcome = await createTransport({ origin }).send(
        request({ url: `${origin}/api/v1/projects`, body: undefined }),
      );
      expect(outcome.kind).toBe("network");
      if (outcome.kind === "network") {
        expect(outcome.message).toContain("ECONNREFUSED");
        expect(outcome.beforeBody).toBe(true);
      }
    }
  });
});

describe("request typing", () => {
  it("requires a bearer on a PUT, and omits it on a GET", () => {
    const read: HttpRequest = {
      method: "GET",
      url: "https://127.0.0.1:8080/api/v1/projects/waves-demo/decisions/d1",
    };
    expect(read.method).toBe("GET");

    // @ts-expect-error a PUT without a bearer does not compile
    const withoutToken: HttpRequest = {
      method: "PUT",
      url: "https://127.0.0.1:8080/api/v1/projects/waves-demo/decisions/d1",
    };
    expect(withoutToken.method).toBe("PUT");
  });
});
