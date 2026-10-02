import { createHash } from "node:crypto";
import { connect } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

import { afterEach, describe, expect, it } from "vitest";

import type { Project, StoredSnapshot } from "@hexagen-monaco/waves-contract";

import type { StorePort } from "../src/application/ports/store.js";
import { MemoryStore } from "../src/infrastructure/memory-store.js";
import {
  cleanupHarnesses,
  logLeaks,
  NOW_MS,
  type Started,
  startHarness,
  finalStatus,
  statusLines,
  watchSecret,
} from "./http-harness.js";

const PROJECT_TOKEN = "project-token-0123456789abcdefghijklmnopq";
const VIEWER_TOKEN = "viewer-token-0123456789abcdefghijklmnop";
const OTHER_TOKEN = "other-token-0123456789abcdefghijklmnopqr";
const UNKNOWN_TOKEN = "unknown-token-0123456789abcdefghijklmno";
const WAVE = "wv1";
const RECEIVED_AT = "2026-10-01T12:01:00.000Z";
const PUT_CAP = 1_048_576;

for (const secret of [PROJECT_TOKEN, OTHER_TOKEN, UNKNOWN_TOKEN]) {
  watchSecret(secret);
}

const BEARER = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
});

const BASIC = (password: string, user = "reader"): Record<string, string> => ({
  authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`,
});

function digestOf(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function envelope(wave = WAVE, project = "alpha"): Record<string, unknown> {
  return {
    schema: "waves/v1",
    project,
    wave,
    generatedAt: "2026-10-01T12:00:00Z",
    intervalSeconds: 10,
    lanes: [{ id: `${wave}-a`, derived: { alive: true }, disagreements: [] }],
  };
}

function wavePath(wave = WAVE, project = "alpha"): string {
  return `/api/v1/projects/${project}/waves/${wave}`;
}

/** A clock the test moves by hand, since the per-project limit is in seconds. */
function clock(): { readonly now: () => number; readonly pass: () => void } {
  let at = NOW_MS;
  return {
    now: () => at,
    pass: () => {
      at += 1_000;
    },
  };
}

async function seeded(
  token = PROJECT_TOKEN,
  id = "alpha",
): Promise<MemoryStore> {
  const store = new MemoryStore();
  await store.putProject({
    id,
    name: "Alpha",
    repo: "https://example.com/alpha.git",
    tokenSha256: digestOf(token),
    registeredAt: "2026-10-01T12:00:00Z",
  });
  return store;
}

interface PutOptions {
  readonly headers?: Record<string, string>;
  readonly path?: string;
  readonly body?: unknown;
  readonly token?: string;
}

/**
 * `body: undefined` sends no body at all, which is what a test about a refusal
 * the server decides from the head alone should do: a body in flight is a body
 * racing a connection the server is about to close, and which side wins that race
 * is a property of the TCP stack rather than of the service.
 */
function put(
  started: Started,
  body: unknown,
  options: PutOptions = {},
): Promise<Response> {
  return fetch(`${started.origin}${options.path ?? wavePath()}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      ...BEARER(options.token ?? PROJECT_TOKEN),
      ...options.headers,
    },
    body:
      body === undefined
        ? undefined
        : typeof body === "string"
          ? body
          : JSON.stringify(body),
  });
}

/** The store as one comparable value, so a test can assert nothing changed. */
async function stateOf(store: MemoryStore): Promise<unknown> {
  return {
    projects: await store.listProjects(),
    waves: await store.listSnapshots("alpha"),
  };
}

/**
 * Streams a body in fixed chunks and reports what the client managed to do
 * before the connection broke: the status it read — 0 for nothing at all, which
 * is what a reset that discards the answer looks like — and how much of the
 * announced body got out.
 */
function stream(
  started: Started,
  headers: readonly string[],
  total: number,
  chunkBytes: number,
): Promise<{ status: number; sent: number }> {
  return new Promise((settled) => {
    const socket = connect(started.port, "127.0.0.1");
    socket.setEncoding("utf8");
    const chunk = "x".repeat(chunkBytes);
    let sent = 0;
    let raw = "";
    let done = false;
    const stop = setInterval(() => {
      if (sent >= total) {
        return;
      }
      if (socket.write(chunk)) {
        sent += chunkBytes;
      }
    }, 4);
    const giveUp = setTimeout(() => {
      finish();
    }, 10_000);
    function finish(): void {
      if (done) {
        return;
      }
      done = true;
      clearInterval(stop);
      clearTimeout(giveUp);
      socket.destroy();
      settled({
        status: Number(raw.split(" ")[1] ?? 0),
        sent,
      });
    }
    socket.on("data", (text: string) => {
      raw += text;
    });
    socket.on("error", finish);
    socket.on("close", finish);
    socket.write(
      [
        `PUT ${wavePath()} HTTP/1.1`,
        "Host: localhost",
        ...headers,
        "Connection: close",
        "",
        "",
      ].join("\r\n"),
    );
  });
}

/**
 * Streams a chunked body — no announced length, so the only thing that can stop
 * it is the cap on the read — and reports the answer and how much got out. The
 * client always finishes what it announced, so a server that never stopped would
 * answer rather than hang.
 */
function streamChunked(
  started: Started,
  method: string,
  path: string,
  headers: readonly string[],
  total: number,
  chunkBytes: number,
): Promise<{ status: number; sent: number }> {
  return new Promise((settled) => {
    const socket = connect(started.port, "127.0.0.1");
    socket.setEncoding("utf8");
    const chunk = "x".repeat(chunkBytes);
    let sent = 0;
    let raw = "";
    let done = false;
    const stop = setInterval(() => {
      if (sent >= total) {
        clearInterval(stop);
        socket.write("0\r\n\r\n");
        return;
      }
      if (socket.write(`${chunkBytes.toString(16)}\r\n${chunk}\r\n`)) {
        sent += chunkBytes;
      }
    }, 2);
    const giveUp = setTimeout(() => {
      finish();
    }, 10_000);
    function finish(): void {
      if (done) {
        return;
      }
      done = true;
      clearInterval(stop);
      clearTimeout(giveUp);
      socket.destroy();
      settled({ status: Number(raw.split(" ")[1] ?? 0), sent });
    }
    socket.on("data", (text: string) => {
      raw += text;
    });
    socket.on("error", () => undefined);
    socket.on("close", finish);
    socket.write(
      [
        `${method} ${path} HTTP/1.1`,
        "Host: localhost",
        ...headers,
        "Connection: close",
        "",
        "",
      ].join("\r\n"),
    );
  });
}

/**
 * How long it took the server to drop its socket, in milliseconds, so a test can
 * say that a connection went on the flush rather than on a timer.
 */
async function firstDestroyed(started: Started): Promise<number> {
  const at = Date.now();
  // A wall-clock deadline, not an iteration count: `delay(1)` takes longer than
  // a millisecond on a loaded runner, so counting iterations would end early.
  const deadline = at + 500;
  while (Date.now() < deadline) {
    if (started.sockets().some((socket) => socket.destroyed)) {
      return Date.now() - at;
    }
    await delay(1);
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * A value that may never arrive, waited for a bounded time, so a test asserts on
 * it rather than waiting out the timeout of the whole test.
 */
async function within<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([work, delay(ms).then(() => undefined)]);
}

afterEach(cleanupHarnesses);

describe("pushing a wave", () => {
  it("stores a valid envelope and serves it back through the read API", async () => {
    const store = await seeded();
    const started = await startHarness({ store });

    const response = await put(started, envelope());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(await response.json()).toEqual({ receivedAt: RECEIVED_AT });
    const wave = await fetch(`${started.origin}${wavePath()}`);
    expect(await wave.json()).toMatchObject({
      envelope: { project: "alpha", wave: WAVE },
      receivedAt: RECEIVED_AT,
    });
    const waves = await fetch(`${started.origin}/api/v1/projects/alpha/waves`);
    expect(await waves.json()).toEqual([
      expect.objectContaining({ wave: WAVE, receivedAt: RECEIVED_AT }),
    ]);
  });

  it("removes a wave with 204 and answers 404 the second time", async () => {
    const store = await seeded();
    const time = clock();
    const started = await startHarness({ store, now: time.now });
    await put(started, envelope());
    time.pass();

    const removed = await fetch(`${started.origin}${wavePath()}`, {
      method: "DELETE",
      headers: BEARER(PROJECT_TOKEN),
    });
    time.pass();

    expect(removed.status).toBe(204);
    expect(removed.headers.get("content-type")).toBe(null);
    expect(removed.headers.get("cache-control")).toBe("no-store");
    expect(await store.listSnapshots("alpha")).toEqual([]);
    const again = await fetch(`${started.origin}${wavePath()}`, {
      method: "DELETE",
      headers: BEARER(PROJECT_TOKEN),
    });
    expect(again.status).toBe(404);
  });

  it("refuses a body on a delete", async () => {
    const store = await seeded();
    const time = clock();
    const started = await startHarness({ store, now: time.now });
    await put(started, envelope());
    time.pass();
    const before = await stateOf(store);

    const response = await fetch(`${started.origin}${wavePath()}`, {
      method: "DELETE",
      headers: {
        ...BEARER(PROJECT_TOKEN),
        "content-type": "application/json",
      },
      body: "{}",
    });

    expect(response.status).toBe(400);
    expect(await stateOf(store)).toEqual(before);
  });

  it("refuses transfer-encoding on a delete", async () => {
    const started = await startHarness({ store: await seeded() });

    const raw = await started.raw(`DELETE ${wavePath()} HTTP/1.1`, [
      `Authorization: Bearer ${PROJECT_TOKEN}`,
      "Transfer-Encoding: chunked",
    ]);

    expect(finalStatus(raw)).toBe("HTTP/1.1 400");
  });
});

describe("every refusal before the body is read", () => {
  it("404s an id the contract refuses, without touching the store", async () => {
    const store = await seeded();
    const calls: string[] = [];
    const watched = new Proxy(store, {
      get(target, property, receiver): unknown {
        if (typeof property === "string" && property !== "constructor") {
          calls.push(property);
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    }) as StorePort<Project, StoredSnapshot>;
    const started = await startHarness({ store: watched });

    const response = await put(started, undefined, {
      path: "/api/v1/projects/Bad%20Id/waves/wv1",
    });

    expect(response.status).toBe(404);
    expect(calls).toEqual([]);
  });

  it("404s a trailing slash, as the router always has", async () => {
    const started = await startHarness({ store: await seeded() });

    expect(
      (await put(started, undefined, { path: `${wavePath()}/` })).status,
    ).toBe(404);
  });

  it("400s a query on a put and closes the connection", async () => {
    const store = await seeded();
    const started = await startHarness({ store });
    const before = await stateOf(store);

    const response = await put(started, undefined, {
      path: `${wavePath()}?rotate=1`,
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("connection")).toBe("close");
    expect(await stateOf(store)).toEqual(before);
  });

  it("403s an Origin before it looks at the content type", async () => {
    const store = await seeded();
    const started = await startHarness({ store });
    const before = await stateOf(store);

    const response = await fetch(`${started.origin}${wavePath()}`, {
      method: "PUT",
      headers: {
        origin: "https://waves.example.invalid",
        "content-type": "text/plain",
      },
    });

    expect(response.status).toBe(403);
    expect(await stateOf(store)).toEqual(before);
  });

  it.each([
    ["no content type at all", {}],
    ["a type that is not json", { "content-type": "text/plain" }],
    [
      "a type the client sent twice",
      { "content-type": "application/json, text/plain" },
    ],
    [
      "a charset it cannot read",
      { "content-type": "application/json; charset=latin1" },
    ],
  ])("415s %s", async (_label, headers) => {
    const store = await seeded();
    const started = await startHarness({ store });
    const before = await stateOf(store);

    const response = await fetch(`${started.origin}${wavePath()}`, {
      method: "PUT",
      headers: { ...BEARER(PROJECT_TOKEN), ...headers },
    });

    expect(response.status).toBe(415);
    expect(await stateOf(store)).toEqual(before);
  });

  it("415s a request that declared no type at all", async () => {
    const store = await seeded();
    const started = await startHarness({ store });
    const before = await stateOf(store);

    const raw = await started.raw(
      `PUT ${wavePath()} HTTP/1.1`,
      [`Authorization: Bearer ${PROJECT_TOKEN}`, "Content-Length: 2"],
      "{}",
    );

    expect(finalStatus(raw)).toBe("HTTP/1.1 415");
    expect(await stateOf(store)).toEqual(before);
  });

  it("accepts the type case-insensitively and a utf-8 charset", async () => {
    const started = await startHarness({ store: await seeded() });

    const response = await fetch(`${started.origin}${wavePath()}`, {
      method: "PUT",
      headers: {
        ...BEARER(PROJECT_TOKEN),
        "content-type": "Application/JSON; CharSet=UTF-8",
      },
      body: JSON.stringify(envelope()),
    });

    expect(response.status).toBe(200);
  });

  it("413s an announced length above the cap and closes", async () => {
    const store = await seeded();
    const started = await startHarness({ store });
    const before = await stateOf(store);
    const bytesBefore = started.bytesRead();

    // The length is announced and the body is not sent: the refusal is about the
    // number in the head, so there is nothing to send, and nothing in flight to
    // lose to a connection the server is closing on purpose.
    const raw = await started.raw(`PUT ${wavePath()} HTTP/1.1`, [
      "Content-Type: application/json",
      `Authorization: Bearer ${PROJECT_TOKEN}`,
      `Content-Length: ${PUT_CAP + 1}`,
    ]);

    expect(finalStatus(raw)).toBe("HTTP/1.1 413");
    expect(raw).toContain("Connection: close");
    expect(raw).toContain("Cache-Control: no-store");
    expect(started.bytesRead() - bytesBefore).toBeLessThan(PUT_CAP);
    expect(await stateOf(store)).toEqual(before);
  });

  it.each([
    ["a token of the wrong shape", "Bearer short"],
    [
      "a Basic header where only a bearer is accepted",
      "Basic bm90LWEtYmVhcmVy",
    ],
    ["a token no project has", `Bearer ${UNKNOWN_TOKEN}`],
  ])("401s %s", async (_label, authorization) => {
    const store = await seeded();
    const started = await startHarness({ store });
    const before = await stateOf(store);

    const response = await put(started, undefined, {
      headers: { authorization },
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer realm="waves"',
    );
    expect(response.headers.get("connection")).toBe("close");
    expect(await stateOf(store)).toEqual(before);
  });

  it("403s a valid token of another project", async () => {
    const store = await seeded();
    await store.putProject({
      id: "beta",
      name: "Beta",
      tokenSha256: digestOf(OTHER_TOKEN),
      registeredAt: "2026-10-01T12:00:00Z",
    });
    const started = await startHarness({ store });
    const before = await stateOf(store);

    const response = await put(started, undefined, {
      headers: BEARER(OTHER_TOKEN),
    });

    expect(response.status).toBe(403);
    expect(await stateOf(store)).toEqual(before);
  });

  it("403s a wave of a project that does not exist", async () => {
    const started = await startHarness({ store: await seeded() });

    const response = await put(started, undefined, {
      path: wavePath(WAVE, "absent"),
    });

    expect(response.status).toBe(403);
  });

  it("400s two Authorization headers", async () => {
    const store = await seeded();
    const started = await startHarness({ store });
    const before = await stateOf(store);
    const body = JSON.stringify(envelope());

    const raw = await started.raw(
      `PUT ${wavePath()} HTTP/1.1`,
      [
        "Content-Type: application/json",
        `Authorization: Bearer ${PROJECT_TOKEN}`,
        `Authorization: Bearer ${OTHER_TOKEN}`,
        `Content-Length: ${Buffer.byteLength(body)}`,
      ],
      body,
    );

    expect(finalStatus(raw)).toBe("HTTP/1.1 400");
    expect(await stateOf(store)).toEqual(before);
  });

  it("405s a method the wave does not take, with its own Allow", async () => {
    const started = await startHarness({ store: await seeded() });

    const patch = await fetch(`${started.origin}${wavePath()}`, {
      method: "PATCH",
    });
    const options = await fetch(`${started.origin}${wavePath()}`, {
      method: "OPTIONS",
    });

    for (const response of [patch, options]) {
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET, HEAD, PUT, DELETE");
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("404s a write to a path that does not exist", async () => {
    const started = await startHarness({ store: await seeded() });

    const response = await put(started, undefined, {
      path: "/api/v1/nope/waves/wv1",
    });

    expect(response.status).toBe(404);
  });

  it("429s the second authenticated attempt on a project, with Retry-After", async () => {
    const store = await seeded();
    const started = await startHarness({ store });
    await put(started, envelope());

    const response = await put(started, undefined);

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("1");
  });

  it("counts an authenticated attempt that was then refused", async () => {
    const store = await seeded();
    const started = await startHarness({ store });

    const refused = await put(started, envelope("wv2"));

    expect(refused.status).toBe(422);
    expect((await put(started, undefined)).status).toBe(429);
  });
});

describe("reading the body", () => {
  it("413s a stream that never ends and cuts the client off", async () => {
    const store = await seeded();
    const started = await startHarness({ store });
    const before = await stateOf(store);
    const bytesBefore = started.bytesRead();

    // Here the body is the point: a client announces two megabytes and keeps
    // writing them. The refusal is decided from the head, so what the client
    // makes of it is a set of accepted outcomes — the 413, or a connection that
    // broke under it, which is what the reset looks like where the kernel
    // discards what the client has not read.
    const streaming = stream(
      started,
      [
        "Content-Type: application/json",
        `Authorization: Bearer ${PROJECT_TOKEN}`,
        "Content-Length: 2097152",
      ],
      2_097_152,
      65_536,
    );
    const droppedAt = await firstDestroyed(started);
    const result = await within(streaming, 2_000);

    // The server's own behaviour: it refused without reading the megabytes, it
    // dropped the connection, and it stored nothing.
    expect([413, 0]).toContain(result?.status ?? 0);
    expect(droppedAt).toBeLessThan(500);
    expect(started.bytesRead() - bytesBefore).toBeLessThan(PUT_CAP);
    expect(await stateOf(store)).toEqual(before);
  });

  it("400s a body that is not utf-8", async () => {
    const started = await startHarness({ store: await seeded() });

    const raw = await started.raw(
      `PUT ${wavePath()} HTTP/1.1`,
      [
        "Content-Type: application/json",
        `Authorization: Bearer ${PROJECT_TOKEN}`,
        "Content-Length: 3",
      ],
      Buffer.from([0xc3, 0x28, 0xff]),
    );

    expect(finalStatus(raw)).toBe("HTTP/1.1 400");
  });

  it("413s a chunked push that passes the cap, and stops reading it", async () => {
    const store = await seeded();
    const started = await startHarness({ store });
    const before = await stateOf(store);

    const result = await streamChunked(
      started,
      "PUT",
      wavePath(),
      [
        "Content-Type: application/json",
        `Authorization: Bearer ${PROJECT_TOKEN}`,
        "Transfer-Encoding: chunked",
      ],
      PUT_CAP + 65_536,
      65_536,
    );

    expect(result.status).toBe(413);
    expect(result.sent).toBeLessThanOrEqual(PUT_CAP + 65_536);
    expect(await stateOf(store)).toEqual(before);
  });

  it("400s a body that is not json", async () => {
    const store = await seeded();
    const started = await startHarness({ store });
    const before = await stateOf(store);

    expect((await put(started, "{not json")).status).toBe(400);
    expect(await stateOf(store)).toEqual(before);
  });

  it("422s an envelope the contract refuses, with its pointers", async () => {
    const store = await seeded();
    const started = await startHarness({ store });
    const before = await stateOf(store);

    const response = await put(started, { schema: "waves/v2", lanes: [] });

    expect(response.status).toBe(422);
    const body = (await response.json()) as { errors: { path: string }[] };
    expect(body.errors.map((issue) => issue.path)).toContain("/schema");
    expect(await stateOf(store)).toEqual(before);
  });

  it("422s an envelope for another wave or project than the path names", async () => {
    const store = await seeded();
    const time = clock();
    const started = await startHarness({ store, now: time.now });

    const wave = await put(started, envelope("wv2"));
    time.pass();
    const project = await put(started, envelope(WAVE, "beta"));

    expect([wave.status, project.status]).toEqual([422, 422]);
    expect(await store.listSnapshots("alpha")).toEqual([]);
  });

  it("accepts a chunked body with no declared length", async () => {
    const store = await seeded();
    const started = await startHarness({ store });
    const body = JSON.stringify(envelope());

    const raw = await started.raw(
      `PUT ${wavePath()} HTTP/1.1`,
      [
        "Content-Type: application/json",
        `Authorization: Bearer ${PROJECT_TOKEN}`,
        "Transfer-Encoding: chunked",
      ],
      `${body.length.toString(16)}\r\n${body}\r\n0\r\n\r\n`,
    );

    expect(raw).toContain("200");
    expect(await store.getSnapshot("alpha", WAVE)).toMatchObject({
      receivedAt: RECEIVED_AT,
    });
  });

  it("400s a request the parser refuses, with the security headers", async () => {
    const started = await startHarness({ store: await seeded() });

    const duplicated = await started.raw(`PUT ${wavePath()} HTTP/1.1`, [
      "Content-Type: application/json",
      "Content-Length: 2",
      "Content-Length: 2",
    ]);
    const both = await started.raw(`PUT ${wavePath()} HTTP/1.1`, [
      "Content-Type: application/json",
      "Content-Length: 2",
      "Transfer-Encoding: chunked",
    ]);

    for (const raw of [duplicated, both]) {
      expect(finalStatus(raw)).toBe("HTTP/1.1 400");
      expect(raw).toContain("X-Content-Type-Options: nosniff");
      expect(raw).toContain("Connection: close");
    }
  });

  it("never reads the body of a request it has already refused", async () => {
    const store = await seeded();
    const started = await startHarness({ store });
    const before = await stateOf(store);
    const bytesBefore = started.bytesRead();

    // The whole body goes out, because a client does not know it is about to be
    // refused.
    const response = await put(started, "x".repeat(PUT_CAP), {
      headers: { authorization: `Bearer ${UNKNOWN_TOKEN}` },
    }).catch((error: Error) => error);

    // What the server did, first and without reference to the client: it took
    // almost nothing off the socket and it stored nothing.
    expect(started.bytesRead() - bytesBefore).toBeLessThan(PUT_CAP);
    expect(await stateOf(store)).toEqual(before);

    // What the client made of it, which is a set of accepted outcomes because it
    // is not the same on every TCP stack. Destroying a socket that still holds
    // unread data resets it, and BSD and macOS discard what the application has
    // not read: there the client may never see the answer, and `fetch` rejects
    // with a cause that has no code at all. Linux usually delivers the 401 first.
    if (response instanceof Error) {
      expect(response).toBeInstanceOf(TypeError);
    } else {
      expect(response.status).toBe(401);
    }
  });

  it("drops a refused connection as soon as the answer has flushed", async () => {
    const started = await startHarness({ store: await seeded() });
    const bytesBefore = started.bytesRead();
    const held = started.sendAndHold(
      `PUT ${wavePath()} HTTP/1.1`,
      [
        "Content-Type: application/json",
        `Authorization: Bearer ${UNKNOWN_TOKEN}`,
        `Content-Length: ${PUT_CAP}`,
      ],
      Buffer.alloc(PUT_CAP, 0x78),
      // Nothing asked for a close on either side, so the only thing that can end
      // this connection is the server refusing the request and dropping it.
      { keepAlive: true },
    );

    // The client keeps the socket open and keeps writing into it, so the only way
    // the server socket can end is the server ending it: on the flush of the
    // refusal, with nothing left to read off it. Both of those are the server's
    // own behaviour and are the same on every TCP stack.
    const droppedAt = await firstDestroyed(started);
    const readAtDrop = started.bytesRead();
    await delay(200);
    const readLater = started.bytesRead();

    expect(droppedAt).toBeLessThan(500);
    // The property the destroy guards: the body was not drained before the drop.
    expect(readAtDrop - bytesBefore).toBeLessThan(PUT_CAP);
    expect(readLater).toBe(readAtDrop);

    // What the client made of it is a set of accepted outcomes, because the reset
    // that drops the connection can take the answer with it: where the kernel
    // discards unread data on close — BSD and macOS — a raw socket reads nothing
    // at all, and where it does not — Linux — the 401 arrives first. It is waited
    // for briefly rather than for ever, so a server that never drops the
    // connection is caught by the assertion above.
    const result = await within(held, 1_000);
    expect(["HTTP/1.1 401", ""]).toContain(result?.status);
  });

  it("answers a request with no body at all on the same socket", async () => {
    const started = await startHarness({ store: await seeded() });

    const result = await started.expecting(
      `DELETE ${wavePath()} HTTP/1.1`,
      [`Authorization: Bearer ${PROJECT_TOKEN}`],
      "",
    );

    // Nothing to read and nothing to wait for: the refusal is the whole answer.
    expect(result.status).toBe("HTTP/1.1 404");
    expect(result.sent).toBe(0);
  });

  it("answers a read that asked to wait, without a 100 and without hanging", async () => {
    const started = await startHarness({ store: await seeded() });

    const result = await started.expecting(
      "GET /api/v1/projects HTTP/1.1",
      ["Expect: 100-continue"],
      "",
    );

    // A read has no body to wait for, so the expectation has nothing to do and
    // the answer is the read: one status line, no 100, nothing sent.
    expect(statusLines(result.body)).toEqual(["HTTP/1.1 200"]);
    expect(result.sent).toBe(0);
  });

  it("refuses a request that asked to wait before its body, without a 100", async () => {
    const store = await seeded();
    const started = await startHarness({ store });
    const before = await stateOf(store);

    const result = await started.expecting(
      `PUT ${wavePath()} HTTP/1.1`,
      [
        "Content-Type: application/json",
        `Authorization: Bearer ${UNKNOWN_TOKEN}`,
        `Content-Length: ${PUT_CAP}`,
        "Expect: 100-continue",
      ],
      "x".repeat(PUT_CAP),
    );

    // No 100 at all, so the client never sent a byte of the body, and the answer
    // is the refusal itself.
    expect(statusLines(result.body)).toEqual(["HTTP/1.1 401"]);
    expect(result.status).toBe("HTTP/1.1 401");
    expect(result.sent).toBe(0);
    expect(started.bytesRead()).toBeLessThan(PUT_CAP);
    expect(await stateOf(store)).toEqual(before);
  });

  it("holds the body of a request it will accept until it says so", async () => {
    const store = await seeded();
    const started = await startHarness({ store });
    const body = JSON.stringify(envelope());

    const result = await started.expecting(
      `PUT ${wavePath()} HTTP/1.1`,
      [
        "Content-Type: application/json",
        `Authorization: Bearer ${PROJECT_TOKEN}`,
        `Content-Length: ${Buffer.byteLength(body)}`,
        "Expect: 100-continue",
      ],
      body,
    );

    expect(statusLines(result.body)).toEqual(["HTTP/1.1 100", "HTTP/1.1 200"]);
    expect(result.sent).toBe(Buffer.byteLength(body));
    expect(await store.getSnapshot("alpha", WAVE)).toMatchObject({
      receivedAt: RECEIVED_AT,
    });
  });

  it("holds the body of a request that asked for an expectation it does not keep", async () => {
    const started = await startHarness({ store: await seeded() });
    const body = JSON.stringify(envelope());

    const refused = await started.expecting(
      `PUT ${wavePath()} HTTP/1.1`,
      [
        "Content-Type: application/json",
        `Authorization: Bearer ${PROJECT_TOKEN}`,
        `Content-Length: ${Buffer.byteLength(body)}`,
        "Expect: 200-ok",
      ],
      body,
    );
    const old = await started.expecting(
      `PUT ${wavePath()} HTTP/1.0`,
      [
        "Content-Type: application/json",
        `Authorization: Bearer ${PROJECT_TOKEN}`,
        `Content-Length: ${Buffer.byteLength(body)}`,
        "Expect: 100-continue",
      ],
      body,
      { waitForContinue: false },
    );

    // Node answers 417 for an expectation it does not implement, and only HTTP/1.1
    // has the expectation at all: an HTTP/1.0 request that carries one anyway is
    // answered without a promise, which the client above ignored by sending its
    // body straight away.
    expect(statusLines(refused.body)).toEqual(["HTTP/1.1 417"]);
    expect(refused.sent).toBe(0);
    expect(statusLines(old.body)).toEqual(["HTTP/1.1 200"]);
    expect(old.sent).toBe(Buffer.byteLength(body));
  });

  it("answers an expectation it does not keep with the headers every other answer carries", async () => {
    const started = await startHarness({ store: await seeded() });
    const body = JSON.stringify(envelope());

    const refused = await started.expecting(
      `PUT ${wavePath()} HTTP/1.1`,
      [
        "Content-Type: application/json",
        `Authorization: Bearer ${PROJECT_TOKEN}`,
        `Content-Length: ${Buffer.byteLength(body)}`,
        "Expect: 200-ok",
      ],
      body,
    );

    expect(statusLines(refused.body)).toEqual(["HTTP/1.1 417"]);
    expect(refused.body).toContain(
      "Content-Security-Policy: default-src 'none'",
    );
    expect(refused.body).toContain("X-Content-Type-Options: nosniff");
    expect(refused.body).toContain("Referrer-Policy: no-referrer");
    expect(refused.body).toContain("Connection: close");
    expect(refused.body).toContain('{"error":"expectation failed"}');
    expect(refused.sent).toBe(0);
  });

  it("drops the connection of an expectation it refused, without reading the body", async () => {
    const started = await startHarness({ store: await seeded() });
    const bytesBefore = started.bytesRead();
    void started.sendAndHold(
      `PUT ${wavePath()} HTTP/1.1`,
      [
        "Content-Type: application/json",
        `Authorization: Bearer ${PROJECT_TOKEN}`,
        `Content-Length: ${PUT_CAP}`,
        "Expect: 200-ok",
      ],
      Buffer.alloc(PUT_CAP, 0x78),
      // Nothing asked for a close on either side, so the only thing that can end
      // this connection is the server dropping it with its 417.
      { keepAlive: true },
    );

    const droppedAt = await firstDestroyed(started);
    const readAtDrop = started.bytesRead();
    await delay(200);

    expect(droppedAt).toBeLessThan(500);
    expect(readAtDrop - bytesBefore).toBeLessThan(PUT_CAP);
    expect(started.bytesRead()).toBe(readAtDrop);
  });

  it("answers a read that asks for the expectation too, uncached on an api path, and logs it", async () => {
    const started = await startHarness({ store: await seeded() });

    const refused = await started.expecting(
      `GET ${wavePath()} HTTP/1.1`,
      ["Expect: 200-ok"],
      "",
    );

    expect(statusLines(refused.body)).toEqual(["HTTP/1.1 417"]);
    expect(refused.body).toContain("Cache-Control: no-store");
    expect(refused.body).toContain("X-Content-Type-Options: nosniff");
    expect(started.logLines().map((line) => JSON.parse(line))).toEqual([
      {
        ts: expect.any(String),
        method: "GET",
        path: wavePath(),
        status: 417,
        ms: expect.any(Number),
      },
    ]);
  });
});

describe("a viewer token and a write token side by side", () => {
  it("keeps writing with Bearer while the reads want Basic", async () => {
    const store = await seeded();
    const started = await startHarness({ store, readToken: VIEWER_TOKEN });

    const pushed = await put(started, envelope());
    const read = await fetch(`${started.origin}/api/v1/projects`, {
      headers: BASIC(VIEWER_TOKEN),
    });
    const bare = await fetch(`${started.origin}/api/v1/projects`);

    expect(pushed.status).toBe(200);
    expect(read.status).toBe(200);
    expect(bare.status).toBe(401);
    expect(bare.headers.get("www-authenticate")).toBe(
      'Basic realm="waves", charset="UTF-8"',
    );
  });

  it("leaves health and readiness open", async () => {
    const started = await startHarness({
      store: await seeded(),
      readToken: VIEWER_TOKEN,
    });

    expect((await fetch(`${started.origin}/healthz`)).status).toBe(200);
    const ready = await fetch(`${started.origin}/readyz`);

    expect(ready.status).toBe(200);
    expect(ready.headers.get("cache-control")).toBe("no-store");
    expect(await ready.json()).toEqual({ ok: true });
  });
});

describe("what the logs carry", () => {
  it("never carries a token, a header or a body", async () => {
    const store = await seeded();
    const time = clock();
    const started = await startHarness({
      store,
      now: time.now,
      readToken: VIEWER_TOKEN,
    });
    await put(started, envelope());
    time.pass();
    await put(started, envelope(), {
      headers: { authorization: `Bearer ${UNKNOWN_TOKEN}` },
    });
    time.pass();
    await fetch(`${started.origin}${wavePath()}`, {
      method: "DELETE",
      headers: BEARER(PROJECT_TOKEN),
    });

    expect(logLeaks()).toEqual([]);
    const written = started.logLines().join("\n");
    expect(written).not.toContain("waves/v1");
    expect(written).not.toContain("Bearer");
    expect(written).not.toContain("unauthorized");
  });
});
