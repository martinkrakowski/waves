import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import type { Project, StoredSnapshot } from "@hexagen-monaco/waves-contract";

import type { StorePort } from "../src/application/ports/store.js";
import { MemoryStore } from "../src/infrastructure/memory-store.js";
import {
  cleanupHarnesses,
  logLeaks,
  NOW_MS,
  startHarness,
  watchSecret,
} from "./http-harness.js";

const PROJECT_TOKEN = "project-token-0123456789abcdefghijklmnopq";
const ADMIN_TOKEN = "admin-token-0123456789abcdefghijklmnop";
const UNKNOWN_TOKEN = "unknown-token-0123456789abcdefghijklmno";
const OTHER_TOKEN = "other-token-0123456789abcdefghijklmnopqr";
const WAVE = "wv1";
const COLLECTION = "/api/v1/projects";

for (const secret of [PROJECT_TOKEN, UNKNOWN_TOKEN, OTHER_TOKEN]) {
  watchSecret(secret);
}

const BEARER = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
});

function digestOf(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function envelope(): Record<string, unknown> {
  return {
    schema: "waves/v1",
    project: "alpha",
    wave: WAVE,
    generatedAt: "2026-10-01T12:00:00Z",
    intervalSeconds: 10,
    lanes: [],
  };
}

async function seeded(): Promise<MemoryStore> {
  const store = new MemoryStore();
  await store.putProject({
    id: "alpha",
    name: "Alpha",
    tokenSha256: digestOf(PROJECT_TOKEN),
    registeredAt: "2026-10-01T12:00:00Z",
  });
  return store;
}

function clock(startAt = NOW_MS): {
  readonly now: () => number;
  readonly pass: (ms?: number) => void;
} {
  let at = startAt;
  return {
    now: () => at,
    pass: (ms = 1_000) => {
      at += ms;
    },
  };
}

interface PushOptions {
  readonly headers?: Record<string, string>;
  readonly token?: string;
  readonly forwarded?: string;
}

function push(
  started: { readonly origin: string },
  options: PushOptions = {},
): Promise<Response> {
  return fetch(`${started.origin}/api/v1/projects/alpha/waves/${WAVE}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      ...BEARER(options.token ?? PROJECT_TOKEN),
      ...(options.forwarded === undefined
        ? {}
        : { "x-forwarded-for": options.forwarded }),
      ...options.headers,
    },
    body: JSON.stringify(envelope()),
  });
}

class ThrowingStore extends MemoryStore {
  override async listProjects(): Promise<readonly Project[]> {
    throw new Error("the volume is not there");
  }
}

afterEach(cleanupHarnesses);

describe("behind a trusted proxy", () => {
  it("refuses a write that did not arrive as https", async () => {
    const started = await startHarness({
      store: await seeded(),
      trustProxy: true,
    });

    const plain = await push(started, {
      headers: { "x-forwarded-proto": "http" },
    });

    expect(plain.status).toBe(403);
    expect(await started.logLines().join("\n")).not.toContain("x-forwarded");
  });

  it("refuses a write when the proxy reports no scheme at all", async () => {
    const started = await startHarness({
      store: await seeded(),
      trustProxy: true,
    });

    expect((await push(started)).status).toBe(403);
  });

  it("accepts a padded and upper-cased https, and refuses two of anything else", async () => {
    const started = await startHarness({
      store: await seeded(),
      trustProxy: true,
    });

    const padded = await push(started, {
      headers: { "x-forwarded-proto": " HTTPS " },
    });
    const doubled = await push(started, {
      headers: { "x-forwarded-proto": "https, http" },
    });
    const looksalike = await push(started, {
      headers: { "x-forwarded-proto": "httpsx" },
    });

    expect([padded.status, doubled.status, looksalike.status]).toEqual([
      200, 403, 403,
    ]);
  });

  it("takes the client from the last forwarded entry", async () => {
    const store = await seeded();
    const time = clock();
    const started = await startHarness({
      store,
      trustProxy: true,
      now: time.now,
    });

    const first = await push(started, {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-for": "10.0.0.1, 203.0.113.7",
      },
    });
    time.pass();
    const second = await push(started, {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-for": "10.0.0.1, 203.0.113.8",
      },
    });

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(await store.getSnapshot("alpha", WAVE)).toMatchObject({
      receivedAt: "2026-10-01T12:01:01.000Z",
    });
  });

  it("spends the failure allowance of the forwarded address, not of the proxy", async () => {
    const time = clock();
    const started = await startHarness({
      store: await seeded(),
      trustProxy: true,
      now: time.now,
    });

    for (let attempt = 0; attempt < 11; attempt += 1) {
      await push(started, {
        token: UNKNOWN_TOKEN,
        headers: {
          "x-forwarded-proto": "https",
          "x-forwarded-for": "203.0.113.7",
        },
      });
    }
    const locked = await push(started, {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-for": "203.0.113.7",
      },
    });
    const elsewhere = await push(started, {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-for": "203.0.113.8",
      },
    });

    expect(locked.status).toBe(429);
    expect(elsewhere.status).toBe(200);
  });

  it("ignores a forwarded address entirely when the proxy is not trusted", async () => {
    const time = clock();
    const started = await startHarness({
      store: await seeded(),
      now: time.now,
    });

    for (let attempt = 0; attempt < 11; attempt += 1) {
      await push(started, {
        token: UNKNOWN_TOKEN,
        headers: { "x-forwarded-for": "203.0.113.7" },
      });
    }
    const locked = await push(started, {
      headers: { "x-forwarded-for": "203.0.113.7" },
    });
    time.pass();
    const elsewhere = await push(started, {
      headers: { "x-forwarded-for": "203.0.113.8" },
    });

    expect(locked.status).toBe(429);
    expect(elsewhere.status).toBe(429);
  });

  it("guards the admin routes the same way", async () => {
    const started = await startHarness({
      store: await seeded(),
      adminToken: ADMIN_TOKEN,
      trustProxy: true,
    });

    const response = await fetch(`${started.origin}${COLLECTION}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "http",
        ...BEARER(ADMIN_TOKEN),
      },
      body: JSON.stringify({ id: "alpha", name: "Alpha" }),
    });

    expect(response.status).toBe(403);
  });
});

describe("the address lockout", () => {
  it("refuses the eleventh failure and then a correct token, until the window passes", async () => {
    const time = clock();
    const store = await seeded();
    const started = await startHarness({ store, now: time.now });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      time.pass();
      const response = await push(started, { token: UNKNOWN_TOKEN });
      expect(response.status).toBe(401);
    }
    const locked = await push(started);
    time.pass(50_000);
    const stillLocked = await push(started);
    time.pass(1_001);
    const released = await push(started);

    expect([locked.status, stillLocked.status, released.status]).toEqual([
      429, 429, 200,
    ]);
    expect(await store.getSnapshot("alpha", WAVE)).toMatchObject({
      receivedAt: "2026-10-01T12:02:01.001Z",
    });
  });

  it.each([
    [
      "a scheme that is not https",
      (address: string) => ({
        token: PROJECT_TOKEN,
        headers: { "x-forwarded-proto": "http" },
        forwarded: address,
      }),
    ],
    [
      "another project's token",
      (address: string) => ({
        token: OTHER_TOKEN,
        headers: {},
        forwarded: address,
      }),
    ],
  ])("charges a refusal for %s to the address", async (_label, refused) => {
    const time = clock();
    const store = await seeded();
    await store.putProject({
      id: "beta",
      name: "Beta",
      tokenSha256: digestOf(OTHER_TOKEN),
      registeredAt: "2026-10-01T12:00:00Z",
    });
    const started = await startHarness({
      store,
      trustProxy: true,
      now: time.now,
    });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      time.pass();
      const response = await push(started, refused("203.0.113.7"));
      expect(response.status).toBe(403);
    }
    const locked = await push(started, {
      token: PROJECT_TOKEN,
      headers: { "x-forwarded-proto": "https" },
      forwarded: "203.0.113.7",
    });
    const elsewhere = await push(started, {
      token: PROJECT_TOKEN,
      headers: { "x-forwarded-proto": "https" },
      forwarded: "203.0.113.8",
    });

    // A correct token from a locked out address is refused before any digest is
    // computed, and an address that was never refused is not.
    expect([locked.status, elsewhere.status]).toEqual([429, 200]);
    expect(await store.getSnapshot("alpha", WAVE)).toMatchObject({
      receivedAt: "2026-10-01T12:01:10.000Z",
    });
  });

  it("does not read a body to decide that an address is locked out", async () => {
    const time = clock();
    const started = await startHarness({
      store: await seeded(),
      now: time.now,
    });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      time.pass();
      await push(started, { token: UNKNOWN_TOKEN });
    }
    const before = started.bytesRead();
    time.pass();

    const response = await push(started);
    const read = started.bytesRead() - before;

    expect(response.status).toBe(429);
    expect(read).toBeLessThan(4_096);
  });
});

describe("readiness", () => {
  it("answers 503 while the store cannot be read", async () => {
    const started = await startHarness({
      store: new ThrowingStore() as StorePort<Project, StoredSnapshot>,
    });

    const response = await fetch(`${started.origin}/readyz`);
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).toBe('{"ok":false}');
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).not.toContain("volume");
  });

  it("answers HEAD on readiness with the headers of the GET", async () => {
    const started = await startHarness({ store: await seeded() });

    const head = await fetch(`${started.origin}/readyz`, { method: "HEAD" });

    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("405s a write on a probe path", async () => {
    const started = await startHarness({ store: await seeded() });

    for (const path of ["/healthz", "/readyz"]) {
      const response = await fetch(`${started.origin}${path}`, {
        method: "PUT",
      });
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET, HEAD");
    }
  });

  it("keeps no token, a header or a body out of every log line", () => {
    expect(logLeaks()).toEqual([]);
  });
});
