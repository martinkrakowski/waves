import { createHash } from "node:crypto";
import { connect } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { MemoryStore } from "../src/infrastructure/memory-store.js";
import {
  cleanupHarnesses,
  logLeaks,
  type Started,
  finalStatus,
  startHarness,
  watchSecret,
} from "./http-harness.js";

const ADMIN_TOKEN = "admin-token-0123456789abcdefghijklmnop";
const VIEWER_TOKEN = "viewer-token-0123456789abcdefghijklmnop";
const WRONG_TOKEN = "wrong-token-0123456789abcdefghijklmnop";
const COLLECTION = "/api/v1/projects";
const POST_CAP = 16_384;

watchSecret(ADMIN_TOKEN);
watchSecret(WRONG_TOKEN);

const BEARER = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
});

const BASIC = (password: string): Record<string, string> => ({
  authorization: `Basic ${Buffer.from(`reader:${password}`).toString("base64")}`,
});

function digestOf(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function registration(id = "alpha", name = "Alpha"): Record<string, unknown> {
  return { id, name, repo: "https://example.com/alpha.git" };
}

async function registered(
  id = "alpha",
  token = "project-token-0123456789abcdefghijklmnopq",
): Promise<MemoryStore> {
  const store = new MemoryStore();
  await store.putProject({
    id,
    name: "Alpha",
    tokenSha256: digestOf(token),
    registeredAt: "2026-10-01T12:00:00Z",
  });
  return store;
}

/** A mint that hands out a different token every time, and remembers them. */
function minting(): {
  readonly mint: () => string;
  readonly issued: string[];
} {
  const issued: string[] = [];
  return {
    issued,
    mint: () => {
      const token = `minted-token-0123456789abcdefghij${issued.length}`;
      issued.push(token);
      return token;
    },
  };
}

interface RegisterOptions {
  readonly query?: string;
  readonly token?: string;
  readonly noToken?: boolean;
  readonly headers?: Record<string, string>;
}

/**
 * `body: undefined` sends no body at all, which is what a test about a refusal
 * the server decides from the head alone should do: a body in flight is a body
 * racing a connection the server is about to close, and which side wins that race
 * is a property of the TCP stack rather than of the service.
 */
function register(
  started: Started,
  body: unknown,
  options: RegisterOptions = {},
): Promise<Response> {
  return fetch(`${started.origin}${COLLECTION}${options.query ?? ""}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options.noToken === true ? {} : BEARER(options.token ?? ADMIN_TOKEN)),
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

function remove(
  started: Started,
  id: string,
  token = ADMIN_TOKEN,
): Promise<Response> {
  return fetch(`${started.origin}${COLLECTION}/${id}`, {
    method: "DELETE",
    headers: BEARER(token),
  });
}

/**
 * Streams a chunked registration body past the registration cap. The client
 * finishes what it announced, so a server that never stopped would answer
 * instead of hanging, and the answer would not be the 413 this expects.
 */
function streamChunked(
  started: { readonly port: number },
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
        `POST ${COLLECTION} HTTP/1.1`,
        "Host: localhost",
        "Content-Type: application/json",
        `Authorization: Bearer ${ADMIN_TOKEN}`,
        "Transfer-Encoding: chunked",
        "Connection: close",
        "",
        "",
      ].join("\r\n"),
    );
  });
}

afterEach(cleanupHarnesses);

describe("registering a project", () => {
  it("mints a token, keeps only its digest, and never sends it again", async () => {
    const store = new MemoryStore();
    const tokens = minting();
    const started = await startHarness({
      store,
      adminToken: ADMIN_TOKEN,
      mint: tokens.mint,
    });

    const response = await register(started, registration());
    watchSecret(tokens.issued[0] ?? "minted-token-0123456789abcdefghij0");

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      id: "alpha",
      token: tokens.issued[0],
    });
    const stored = await store.getProject("alpha");
    expect(stored).toMatchObject({
      id: "alpha",
      name: "Alpha",
      repo: "https://example.com/alpha.git",
      tokenSha256: digestOf(tokens.issued[0] ?? ""),
      registeredAt: "2026-10-01T12:01:00.000Z",
    });
    const state = JSON.stringify(await store.listProjects());
    expect(state).not.toContain(tokens.issued[0] ?? "");
    const listed = await fetch(`${started.origin}${COLLECTION}`);
    expect(await listed.text()).not.toContain(tokens.issued[0] ?? "");
  });

  it("409s an id that is already registered", async () => {
    const store = await registered();
    const started = await startHarness({
      store,
      adminToken: ADMIN_TOKEN,
      mint: minting().mint,
    });

    const response = await register(started, registration());

    expect(response.status).toBe(409);
    expect((await store.getProject("alpha"))?.name).toBe("Alpha");
  });

  it("rotates the token on request and keeps the registration date", async () => {
    const store = await registered();
    const tokens = minting();
    const started = await startHarness({
      store,
      adminToken: ADMIN_TOKEN,
      mint: tokens.mint,
    });

    const response = await register(started, registration("alpha", "Beta"), {
      query: "?rotate=1",
    });
    watchSecret(tokens.issued[0] ?? "minted-token-0123456789abcdefghij0");
    const pushed = await fetch(
      `${started.origin}/api/v1/projects/alpha/waves/wv1`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          ...BEARER(tokens.issued[0] ?? ""),
        },
        body: JSON.stringify({
          schema: "waves/v1",
          project: "alpha",
          wave: "wv1",
          generatedAt: "2026-10-01T12:00:00Z",
          intervalSeconds: 10,
          lanes: [],
        }),
      },
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      id: "alpha",
      token: tokens.issued[0],
    });
    expect(await store.getProject("alpha")).toMatchObject({
      name: "Beta",
      registeredAt: "2026-10-01T12:00:00Z",
      tokenSha256: digestOf(tokens.issued[0] ?? ""),
    });
    expect(pushed.status).toBe(200);
    const stale = await fetch(
      `${started.origin}/api/v1/projects/alpha/waves/wv1`,
      {
        method: "DELETE",
        headers: BEARER("project-token-0123456789abcdefghijklmnopq"),
      },
    );
    expect(stale.status).toBe(401);
  });

  it.each([
    [
      "a key the client does not own",
      { ...registration(), tokenSha256: "a".repeat(64) },
    ],
    ["a body that is not an object", ["alpha"]],
    ["a name the contract refuses", { id: "alpha", name: "" }],
    [
      "a repo that is not https",
      { id: "alpha", name: "Alpha", repo: "http://example.com" },
    ],
    ["an id the contract refuses", { id: "Alpha", name: "Alpha" }],
    ["an id that is not a string", { id: 7, name: "Alpha" }],
  ])("422s %s, and stores nothing", async (_label, body) => {
    const store = new MemoryStore();
    const started = await startHarness({
      store,
      adminToken: ADMIN_TOKEN,
      mint: minting().mint,
    });

    const response = await register(started, body);

    expect(response.status).toBe(422);
    const body422 = (await response.json()) as { errors: { path: string }[] };
    expect(body422.errors.length).toBeGreaterThan(0);
    expect(await store.listProjects()).toEqual([]);
  });

  it("400s a body that is not json", async () => {
    const started = await startHarness({
      store: new MemoryStore(),
      adminToken: ADMIN_TOKEN,
      mint: minting().mint,
    });

    expect((await register(started, "{")).status).toBe(400);
  });

  it("400s a query it does not know", async () => {
    const started = await startHarness({
      store: new MemoryStore(),
      adminToken: ADMIN_TOKEN,
      mint: minting().mint,
    });

    expect(
      (await register(started, undefined, { query: "?rotate=2" })).status,
    ).toBe(400);
  });

  it("413s an announced length above its own, much smaller cap", async () => {
    const store = new MemoryStore();
    const started = await startHarness({
      store,
      adminToken: ADMIN_TOKEN,
      mint: minting().mint,
    });

    // The length is announced and the body is not sent: the refusal is about the
    // number in the head, so there is nothing to send and nothing in flight to
    // lose to a connection the server is closing on purpose.
    const raw = await started.raw(`POST ${COLLECTION} HTTP/1.1`, [
      "Content-Type: application/json",
      `Authorization: Bearer ${ADMIN_TOKEN}`,
      `Content-Length: ${POST_CAP + 1}`,
    ]);

    expect(finalStatus(raw)).toBe("HTTP/1.1 413");
    expect(raw).toContain("Connection: close");
    expect(await store.listProjects()).toEqual([]);
  });

  it("413s a chunked registration that passes the cap, and stores nothing", async () => {
    const store = new MemoryStore();
    const started = await startHarness({
      store,
      adminToken: ADMIN_TOKEN,
      mint: minting().mint,
    });

    const result = await streamChunked(started, 32_768, 4096);

    expect(result.status).toBe(413);
    expect(await store.listProjects()).toEqual([]);
  });

  it("415s a body that is not json, before it reads it", async () => {
    const started = await startHarness({
      store: new MemoryStore(),
      adminToken: ADMIN_TOKEN,
      mint: minting().mint,
    });

    const response = await register(started, undefined, {
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });

    expect(response.status).toBe(415);
  });

  it("403s an Origin", async () => {
    const started = await startHarness({
      store: new MemoryStore(),
      adminToken: ADMIN_TOKEN,
      mint: minting().mint,
    });

    const response = await register(started, undefined, {
      headers: { origin: "https://waves.example.invalid" },
    });

    expect(response.status).toBe(403);
  });
});

describe("the admin routes without an admin token", () => {
  it("404s exactly as an unknown path does", async () => {
    const started = await startHarness({ store: new MemoryStore() });

    const collection = await register(started, registration());
    const project = await remove(started, "alpha");

    expect([collection.status, project.status]).toEqual([404, 404]);
    const raw = await started.raw(
      `POST ${COLLECTION} HTTP/1.1`,
      [
        "Content-Type: application/json",
        `Authorization: Bearer ${ADMIN_TOKEN}`,
        "Content-Length: 2",
      ],
      "{}",
    );
    const stranger = await started.raw(
      "POST /api/v1/nope HTTP/1.1",
      [
        "Content-Type: application/json",
        `Authorization: Bearer ${ADMIN_TOKEN}`,
        "Content-Length: 2",
      ],
      "{}",
    );

    expect(raw.split("\r\n\r\n")[1]).toBe(stranger.split("\r\n\r\n")[1]);
    expect(raw).toContain("Cache-Control: no-store");
    expect(stranger).toContain("Cache-Control: no-store");
    expect(raw).not.toContain("Allow");
    expect(raw).not.toContain("WWW-Authenticate");
  });

  it("405s a read method on the collection, since POST is what writes there", async () => {
    const started = await startHarness({ store: new MemoryStore() });

    const put = await fetch(`${started.origin}${COLLECTION}`, {
      method: "PUT",
    });

    expect(put.status).toBe(405);
    expect(put.headers.get("allow")).toBe("GET, HEAD, POST");
  });
});

describe("the admin token", () => {
  it.each([
    ["a wrong token", WRONG_TOKEN],
    ["a project token", "project-token-0123456789abcdefghijklmnopq"],
    ["nothing at all", undefined],
  ])("401s %s", async (_label, token) => {
    const started = await startHarness({
      store: await registered(),
      adminToken: ADMIN_TOKEN,
      mint: minting().mint,
    });

    const response = await register(started, undefined, {
      noToken: token === undefined,
      token,
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer realm="waves"',
    );
  });

  it("401s a Basic header where only a bearer is accepted", async () => {
    const started = await startHarness({
      store: await registered(),
      adminToken: ADMIN_TOKEN,
      readToken: VIEWER_TOKEN,
      mint: minting().mint,
    });

    const response = await register(started, undefined, {
      headers: BASIC(VIEWER_TOKEN),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer realm="waves"',
    );
  });

  it("400s two Authorization headers", async () => {
    const started = await startHarness({
      store: new MemoryStore(),
      adminToken: ADMIN_TOKEN,
      mint: minting().mint,
    });
    const body = JSON.stringify(registration());

    const raw = await started.raw(
      `POST ${COLLECTION} HTTP/1.1`,
      [
        "Content-Type: application/json",
        `Authorization: Bearer ${ADMIN_TOKEN}`,
        `Authorization: Bearer ${WRONG_TOKEN}`,
        `Content-Length: ${Buffer.byteLength(body)}`,
      ],
      body,
    );

    expect(finalStatus(raw)).toBe("HTTP/1.1 400");
  });

  it("works while a viewer token guards the reads", async () => {
    const store = new MemoryStore();
    const started = await startHarness({
      store,
      adminToken: ADMIN_TOKEN,
      readToken: VIEWER_TOKEN,
      mint: minting().mint,
    });

    const response = await register(started, registration());

    expect(response.status).toBe(201);
    const read = await fetch(`${started.origin}${COLLECTION}`, {
      headers: BASIC(VIEWER_TOKEN),
    });
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual([
      expect.objectContaining({ id: "alpha", name: "Alpha" }),
    ]);
  });
});

describe("removing a project", () => {
  it("takes the project and its snapshots with it", async () => {
    const store = await registered();
    await store.putSnapshot({
      envelope: {
        schema: "waves/v1",
        project: "alpha",
        wave: "wv1",
        generatedAt: "2026-10-01T12:00:00Z",
        intervalSeconds: 10,
        lanes: [],
      },
      receivedAt: "2026-10-01T12:00:01Z",
    });
    const started = await startHarness({ store, adminToken: ADMIN_TOKEN });

    const response = await remove(started, "alpha");

    expect(response.status).toBe(204);
    expect(response.headers.get("content-type")).toBe(null);
    expect(await store.getProject("alpha")).toBeUndefined();
    expect(await store.listSnapshots("alpha")).toEqual([]);
    expect(await store.listSnapshotHeads("alpha")).toEqual([]);
  });

  it("404s an id that was never there", async () => {
    const started = await startHarness({
      store: new MemoryStore(),
      adminToken: ADMIN_TOKEN,
    });

    expect((await remove(started, "absent")).status).toBe(404);
  });

  it("400s a query on a delete", async () => {
    const started = await startHarness({
      store: await registered(),
      adminToken: ADMIN_TOKEN,
    });

    expect((await remove(started, "alpha?rotate=1")).status).toBe(400);
  });
});

describe("what the admin logs carry", () => {
  it("never carries the admin token or a minted one", async () => {
    const store = await registered();
    const tokens = minting();
    const started = await startHarness({
      store,
      adminToken: ADMIN_TOKEN,
      mint: tokens.mint,
    });
    await register(started, registration("alpha"), { query: "?rotate=1" });
    watchSecret(tokens.issued[0] ?? "minted-token-0123456789abcdefghij0");
    await register(started, registration(), { token: WRONG_TOKEN });

    expect(logLeaks()).toEqual([]);
    const written = started.logLines().join("\n");
    expect(written).not.toContain("Bearer");
    expect(written).not.toContain("tokenSha256");
  });
});
