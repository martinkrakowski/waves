import { afterEach, describe, expect, it } from "vitest";

import type { Project, StoredSnapshot } from "@hexagen-monaco/waves-contract";

import type { StorePort } from "../src/application/ports/store.js";
import { MemoryStore } from "../src/infrastructure/memory-store.js";
import { cleanupHarnesses, startHarness } from "./http-harness.js";
import { project, snapshot } from "./store-contract.js";

const TOKEN = "s3cret-read-token";
const RECEIVED_AT_MS = Date.parse("2026-10-01T12:00:01Z");
const STALE_AFTER_MS = 30_000;

const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  [
    "content-security-policy",
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  ],
  ["x-content-type-options", "nosniff"],
  ["referrer-policy", "no-referrer"],
];

function expectSecurityHeaders(headers: Headers, api: boolean): void {
  for (const [name, value] of SECURITY_HEADERS) {
    expect(headers.get(name)).toBe(value);
  }
  expect(headers.get("cache-control")).toBe(api ? "no-store" : null);
  for (const name of headers.keys()) {
    expect(name.toLowerCase().startsWith("access-control-")).toBe(false);
  }
}

class BrokenStore extends MemoryStore {
  readonly #error: unknown;

  constructor(error: unknown) {
    super();
    this.#error = error;
  }

  override async listProjects(): Promise<readonly Project[]> {
    throw this.#error;
  }
}

async function seeded(): Promise<StorePort<Project, StoredSnapshot>> {
  const store = new MemoryStore();
  await store.putProject(project("alpha", "Alpha"));
  await store.putSnapshot({
    ...snapshot("wv1"),
    envelope: {
      ...snapshot("wv1").envelope,
      lanes: [{ id: "wv1-a", derived: { alive: true }, disagreements: [] }],
    },
  });
  return store;
}

function bodyOf(raw: string): string {
  return raw.split("\r\n\r\n").slice(1).join("\r\n\r\n");
}

afterEach(cleanupHarnesses);

describe("the API surface", () => {
  it("answers health without touching the store", async () => {
    const started = await startHarness({ readToken: TOKEN });

    const response = await fetch(`${started.origin}/healthz`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(await response.json()).toEqual({ ok: true });
  });

  it("lists the projects", async () => {
    const started = await startHarness({ store: await seeded() });

    const response = await fetch(`${started.origin}/api/v1/projects`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expectSecurityHeaders(response.headers, true);
    expect(JSON.parse(body)).toEqual([
      {
        id: "alpha",
        name: "Alpha",
        repo: "https://example.com/alpha.git",
        registeredAt: "2026-10-01T12:00:00Z",
        waves: 1,
        lastPush: "2026-10-01T12:00:01Z",
      },
    ]);
    expect(body).not.toContain("tokenSha256");
  });

  it("lists the waves with the stale and retained flags", async () => {
    const started = await startHarness({
      store: await seeded(),
      now: () => RECEIVED_AT_MS + STALE_AFTER_MS + 1,
    });

    const response = await fetch(
      `${started.origin}/api/v1/projects/alpha/waves`,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        wave: "wv1",
        receivedAt: "2026-10-01T12:00:01Z",
        intervalSeconds: 10,
        stale: true,
        retained: true,
        lanes: 1,
      },
    ]);
  });

  it("returns a stale wave with the alive lane shown as unknown", async () => {
    const started = await startHarness({
      store: await seeded(),
      now: () => RECEIVED_AT_MS + STALE_AFTER_MS + 1,
    });

    const response = await fetch(
      `${started.origin}/api/v1/projects/alpha/waves/wv1`,
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(body)).toEqual({
      envelope: {
        schema: "waves/v1",
        project: "alpha",
        wave: "wv1",
        generatedAt: "2026-10-01T12:00:00Z",
        intervalSeconds: 10,
        lanes: [
          {
            id: "wv1-a",
            derived: { alive: "unknown" },
            disagreements: [],
          },
        ],
      },
      receivedAt: "2026-10-01T12:00:01Z",
      stale: true,
      staleAfterMs: STALE_AFTER_MS,
    });
    expect(body).not.toContain("tokenSha256");
  });

  it.each([
    ["/api/v1/projects/absent/waves", "an unknown project"],
    ["/api/v1/projects/absent/waves/wv1", "an unknown project wave"],
    ["/api/v1/projects/alpha/waves/absent", "an unknown wave"],
    ["/api/v1/projects/Bad%20Id/waves", "an invalid project id"],
    ["/api/v1/projects/alpha/waves/not.a.wave", "an invalid wave id"],
  ])("answers 404 for %s (%s)", async (path) => {
    const started = await startHarness({ store: await seeded() });

    const response = await fetch(`${started.origin}${path}`);

    expect(response.status).toBe(404);
    expectSecurityHeaders(response.headers, true);
    expect(await response.json()).toEqual({ error: "not found" });
  });

  it("never lets an invalid segment reach the store", async () => {
    const store = new MemoryStore();
    const calls: string[] = [];
    const watched = new Proxy(store, {
      get(target, property, receiver): unknown {
        if (typeof property === "string" && property !== "constructor") {
          calls.push(property);
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const started = await startHarness({
      store: watched as StorePort<Project, StoredSnapshot>,
    });

    const response = await fetch(
      `${started.origin}/api/v1/projects/Bad%20Id/waves`,
    );

    expect(response.status).toBe(404);
    expect(calls).toEqual([]);
  });
});

describe("the read token", () => {
  const basic = (password: string, user = "reader"): string =>
    `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

  it("refuses every route but health without a token", async () => {
    const started = await startHarness({
      store: await seeded(),
      readToken: TOKEN,
    });

    const response = await fetch(`${started.origin}/api/v1/projects`);

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      'Basic realm="waves", charset="UTF-8"',
    );
    expectSecurityHeaders(response.headers, true);
  });

  it("refuses a wrong token", async () => {
    const started = await startHarness({
      store: await seeded(),
      readToken: TOKEN,
    });

    const response = await fetch(`${started.origin}/api/v1/projects`, {
      headers: { authorization: basic("wrong") },
    });

    expect(response.status).toBe(401);
  });

  it.each([
    ["Basic !!!!", "a malformed base64 payload"],
    ["Basic", "no payload at all"],
    ["Bearer abcdefgh", "another scheme"],
    [`Basic ${Buffer.from("no-separator").toString("base64")}`, "no separator"],
    ["Basic abc", "a truncated payload"],
  ])("refuses %s (%s)", async (header) => {
    const started = await startHarness({
      store: await seeded(),
      readToken: TOKEN,
    });

    const response = await fetch(`${started.origin}/api/v1/projects`, {
      headers: { authorization: header },
    });

    expect(response.status).toBe(401);
  });

  it("accepts the right token under any user name", async () => {
    const started = await startHarness({
      store: await seeded(),
      readToken: TOKEN,
    });

    const response = await fetch(`${started.origin}/api/v1/projects`, {
      headers: { authorization: basic(TOKEN, "someone-else") },
    });

    expect(response.status).toBe(200);
    expectSecurityHeaders(response.headers, true);
  });

  it("keeps the page and the assets behind the token", async () => {
    const started = await startHarness({
      store: await seeded(),
      readToken: TOKEN,
    });

    expect((await fetch(`${started.origin}/`)).status).toBe(401);
    expect((await fetch(`${started.origin}/app.js`)).status).toBe(401);
    expect((await fetch(`${started.origin}/healthz`)).status).toBe(200);
  });
});

describe("failures", () => {
  it("answers 405 with the path's own Allow for every method that path does not take", async () => {
    const started = await startHarness({ store: await seeded() });

    for (const method of ["PUT", "DELETE", "PATCH"]) {
      const response = await fetch(`${started.origin}/api/v1/projects`, {
        method,
      });

      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET, HEAD, POST");
      expectSecurityHeaders(response.headers, true);
    }
  });

  it("answers 405 with Allow for the paths a write belongs to", async () => {
    const started = await startHarness({ store: await seeded() });

    const wave = await fetch(
      `${started.origin}/api/v1/projects/alpha/waves/wv1`,
      { method: "POST" },
    );
    const waves = await fetch(`${started.origin}/api/v1/projects/alpha/waves`, {
      method: "PUT",
    });
    const project = await fetch(`${started.origin}/api/v1/projects/alpha`, {
      method: "GET",
    });

    expect([wave.status, waves.status, project.status]).toEqual([
      405, 405, 405,
    ]);
    expect(wave.headers.get("allow")).toBe("GET, HEAD, PUT, DELETE");
    expect(waves.headers.get("allow")).toBe("GET, HEAD");
    expect(project.headers.get("allow")).toBe("DELETE");
  });

  it("answers HEAD with the headers of the GET and no body", async () => {
    const started = await startHarness({ store: await seeded() });

    const head = await fetch(`${started.origin}/api/v1/projects`, {
      method: "HEAD",
    });
    const get = await fetch(`${started.origin}/api/v1/projects`);

    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(
      get.headers.get("content-length"),
    );
    expect(await head.text()).toBe("");
  });

  it("answers 414 for an oversized url", async () => {
    const started = await startHarness({ store: await seeded() });

    const response = await started.raw(
      `GET /api/v1/projects/${"a".repeat(3000)}`,
    );

    expect(response).toContain("414");
    expect(response).toContain("uri too long");
  });

  it("answers 431 with the security headers for an oversized header block", async () => {
    const started = await startHarness({ store: await seeded() });

    const response = await started.raw("GET /healthz HTTP/1.1", [
      `X-Big: ${"a".repeat(20_000)}`,
    ]);

    expect(response).toContain("431 Request Header Fields Too Large");
    expect(response).toContain(
      "Content-Security-Policy: default-src 'none'; script-src 'self';",
    );
    expect(response).toContain("X-Content-Type-Options: nosniff");
    expect(response).toContain("Referrer-Policy: no-referrer");
    expect(response).toContain("Connection: close");
    expect(bodyOf(response)).toBe("");
  });

  it("answers 400 with the security headers for a malformed request", async () => {
    const started = await startHarness({ store: await seeded() });

    const response = await started.raw("NOT-A-REQUEST");

    expect(response).toContain("400 Bad Request");
    expect(response).toContain("X-Content-Type-Options: nosniff");
  });

  it("answers 500 with a generic body when the store fails", async () => {
    for (const error of [new Error("the disk is on fire"), "a bare string"]) {
      const started = await startHarness({ store: new BrokenStore(error) });

      const response = await fetch(`${started.origin}/api/v1/projects`);
      const body = await response.text();
      const request = started
        .logLines()
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .find((line) => line.status !== undefined);

      expect(response.status).toBe(500);
      expect(body).toBe('{"error":"internal"}');
      expect(body).not.toContain("disk");
      expect(body).not.toContain("Error");
      expectSecurityHeaders(response.headers, true);
      expect(request?.status).toBe(500);
      await started.stop();
    }
  });
});
