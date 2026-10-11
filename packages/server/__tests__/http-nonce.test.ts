import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { MAX_DECISIONS_PER_PROJECT } from "@hexagen-monaco/waves-contract";

import { MemoryStore } from "../src/index.js";
import { EXPECTED_ORIGIN } from "../src/infrastructure/assertion-verifier.js";
import {
  cleanupHarnesses,
  finalStatus,
  logLeaks,
  NOW_MS,
  startHarness,
  type Started,
} from "./http-harness.js";
import { buildAssertion } from "./assertion-helper.js";
import { storedEntry, storedRevision } from "./notice-contract.js";

const PROJECT_TOKEN = "project-token-0123456789abcdefghijklmnopq";
const ADMIN_TOKEN = "admin-token-0123456789abcdefghijklmnopqrstuv";
const READ_TOKEN = "read-token-0123456789abcdefghijklmnopqrs";
const UNKNOWN_TOKEN = "unknown-token-0123456789abcdefghijklmno";

const PROJECT = "alpha";
const ID = "d1";

function digestOf(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function noncePath(id = ID, project = PROJECT): string {
  return `/api/v1/projects/${project}/decisions/${id}/nonce`;
}
function answersPath(id = ID, project = PROJECT): string {
  return `/api/v1/projects/${project}/decisions/${id}/answers`;
}

function clock() {
  let at = NOW_MS;
  return {
    now: () => at,
    pass: () => {
      at += 1_000;
    },
  };
}

/**
 * The nonce source of every test but `randomNonce`'s own: a counter, so no
 * test depends on the bytes of a random value, and so a test can say exactly
 * which nonce the route should have answered and how many were issued.
 */
function nonceCounter(): { source: () => string; issued: readonly string[] } {
  const issued: string[] = [];
  return {
    source: () => {
      const value = `nonce-${issued.length + 1}`;
      issued.push(value);
      return value;
    },
    issued,
  };
}

async function seededStore(): Promise<MemoryStore> {
  const store = new MemoryStore();
  await store.putProject({
    id: PROJECT,
    name: "Alpha",
    repo: "https://example.com/alpha.git",
    tokenSha256: digestOf(PROJECT_TOKEN),
    registeredAt: "2026-10-01T12:00:00Z",
  });
  return store;
}

async function wired(
  options: {
    readonly decisions?: readonly string[];
    readonly adminToken?: string;
    readonly readToken?: string;
  } = {},
): Promise<{
  readonly started: Started;
  readonly store: MemoryStore;
  readonly pass: () => void;
  readonly issued: readonly string[];
}> {
  const store = await seededStore();
  const decisions = options.decisions ?? [ID];
  for (const id of decisions) {
    await store.appendRevision(
      PROJECT,
      id,
      storedRevision(1, id),
      0,
      MAX_DECISIONS_PER_PROJECT,
    );
  }
  const clk = clock();
  const counter = nonceCounter();
  const started = await startHarness({
    store,
    now: clk.now,
    ownerKeys: buildAssertion().keys,
    nonceSource: counter.source,
    adminToken: options.adminToken,
    readToken: options.readToken,
  });
  return { started, store, pass: clk.pass, issued: counter.issued };
}

/** One nonce ask, with whatever headers the test wants to send. */
function ask(
  started: Started,
  path: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${started.origin}${path}`, { method: "POST", headers });
}

afterEach(() => cleanupHarnesses().then(() => expect(logLeaks()).toEqual([])));

describe("the nonce route with keys loaded", () => {
  it("answers a nonce and the next entry's index, and nothing else", async () => {
    const { started } = await wired();

    const response = await ask(started, noncePath());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ nonce: "nonce-1", index: 0 });
  });

  it("follows the decision's entries", async () => {
    const { started, store, pass } = await wired();

    const first = await ask(started, noncePath());
    expect(await first.json()).toEqual({ nonce: "nonce-1", index: 0 });

    await store.appendEntry(PROJECT, ID, storedEntry(0), 0, 1);
    pass();
    const second = await ask(started, noncePath());
    expect(await second.json()).toEqual({ nonce: "nonce-2", index: 1 });
  });

  it("ignores an Authorization header and a cookie", async () => {
    const { started, pass } = await wired({ adminToken: ADMIN_TOKEN });

    // The project token, which writes only this project, and a cookie the
    // route never asked for: neither changes the answer a tokenless ask gets.
    const withProjectToken = await ask(started, noncePath(), {
      authorization: `Bearer ${PROJECT_TOKEN}`,
      cookie: "session=1",
    });
    expect(withProjectToken.status).toBe(200);
    expect(await withProjectToken.json()).toEqual({
      nonce: "nonce-1",
      index: 0,
    });

    pass();
    const withAdminToken = await ask(started, noncePath(), {
      authorization: `Bearer ${ADMIN_TOKEN}`,
    });
    expect(withAdminToken.status).toBe(200);
    expect(await withAdminToken.json()).toEqual({ nonce: "nonce-2", index: 0 });
  });

  it("refuses a query string", async () => {
    const { started } = await wired();

    const response = await ask(started, `${noncePath()}?x=1`);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "bad query" });
  });

  it("refuses a foreign Origin and passes its own", async () => {
    const { started, pass } = await wired();

    const foreign = await ask(started, noncePath(), {
      origin: "https://waves.example.invalid",
    });
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toEqual({
      error: "cross-origin writes refused",
    });

    pass();
    const own = await ask(started, noncePath(), {
      origin: EXPECTED_ORIGIN,
    });
    expect(own.status).toBe(200);
    expect(await own.json()).toEqual({ nonce: "nonce-1", index: 0 });
  });

  it("refuses a body, declared or chunked", async () => {
    const { started } = await wired();

    const declared = await fetch(`${started.origin}${noncePath()}`, {
      method: "POST",
      body: "x",
    });
    expect(declared.status).toBe(400);
    expect(await declared.json()).toEqual({
      error: "a nonce request carries no body",
    });

    const chunked = await started.raw(
      `POST ${noncePath()} HTTP/1.1`,
      ["Transfer-Encoding: chunked"],
      "1\r\nx\r\n0\r\n\r\n",
    );
    expect(finalStatus(chunked)).toBe("HTTP/1.1 400");
    expect(chunked).toContain("a nonce request carries no body");
  });

  it("429s an address the write path has locked out", async () => {
    const { started } = await wired();
    // Ten failed tokens through the write path, all from this test's address,
    // spend the failure window the nonce route shares with it.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const refused = await fetch(
        `${started.origin}/api/v1/projects/${PROJECT}/decisions/${ID}`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${UNKNOWN_TOKEN}`,
          },
          body: JSON.stringify({}),
        },
      );
      expect(refused.status).toBe(401);
    }

    const response = await ask(started, noncePath());
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "too many failures" });
  });

  it("429s a second ask from one address within a second", async () => {
    const { started } = await wired();

    const first = await ask(started, noncePath());
    expect(first.status).toBe(200);

    const second = await ask(started, noncePath());
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBe("1");
    expect(await second.json()).toEqual({ error: "too many writes" });
  });

  it("404s an unknown project or decision, and issues no nonce", async () => {
    const { started, pass, issued } = await wired();

    const project = await ask(started, noncePath(ID, "beta"));
    expect(project.status).toBe(404);
    expect(await project.json()).toEqual({ error: "not found" });

    // The allowance is spent before the project is read, so the second ask
    // needs its own second, exactly as an answered ask would.
    pass();
    const decision = await ask(started, noncePath("absent"));
    expect(decision.status).toBe(404);
    expect(await decision.json()).toEqual({ error: "not found" });

    expect(issued).toEqual([]);
  });

  it("refuses the answers path without a JSON content type", async () => {
    const { started } = await wired();

    const response = await ask(started, answersPath());
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: "unsupported media type" });
  });

  it("answers a fifth ask for one decision", async () => {
    // Five asks cross the per-decision cap of four, and the route still
    // answers each one with a different nonce: a cap drops the oldest nonce
    // rather than refusing (that the oldest is the one dropped is pinned in
    // nonce-store.test.ts, not here).
    const { started, pass } = await wired();

    const nonces: string[] = [];
    for (let askNumber = 1; askNumber <= 5; askNumber += 1) {
      if (askNumber > 1) {
        pass();
      }
      const response = await ask(started, noncePath());
      expect(response.status).toBe(200);
      nonces.push(((await response.json()) as { nonce: string }).nonce);
    }
    expect(new Set(nonces).size).toBe(5);
  });

  it("keeps answering past both caps, a second apart", async () => {
    // Seventeen decisions of four asks each cross the per-decision cap on the
    // way to the total one, and the 65th ask is past both: every ask still
    // answers, because a cap drops the oldest nonce rather than refusing.
    const decisions = Array.from(
      { length: 17 },
      (_unused, index) => `d${index + 1}`,
    );
    const { started, pass } = await wired({ decisions });

    for (let index = 0; index < 65; index += 1) {
      if (index > 0) {
        pass();
      }
      const response = await ask(
        started,
        noncePath(decisions[Math.floor(index / 4)]),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        nonce: `nonce-${index + 1}`,
        index: 0,
      });
    }
  });
});

describe("the nonce route with a read token", () => {
  const CREDENTIAL = `Basic ${Buffer.from(`waves:${READ_TOKEN}`).toString("base64")}`;

  it("refuses a tokenless ask with the read routes' 401 and issues no nonce", async () => {
    const { started, pass, issued } = await wired({ readToken: READ_TOKEN });

    const refused = await ask(started, noncePath());
    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual({ error: "unauthorized" });
    expect(refused.headers.get("www-authenticate")).toBe(
      'Basic realm="waves", charset="UTF-8"',
    );
    expect(refused.headers.get("cache-control")).toBe("no-store");
    expect(issued).toEqual([]);

    // The refused ask spent no allowance and stored nothing, so the next ask
    // a second later is the first nonce the decision has ever been given.
    pass();
    const later = await ask(started, noncePath(), {
      authorization: CREDENTIAL,
    });
    expect(later.status).toBe(200);
    expect(await later.json()).toEqual({ nonce: "nonce-1", index: 0 });
  });

  it("answers an ask with the right credential", async () => {
    const { started } = await wired({ readToken: READ_TOKEN });

    const response = await ask(started, noncePath(), {
      authorization: CREDENTIAL,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ nonce: "nonce-1", index: 0 });
  });

  it("refuses a wrong credential", async () => {
    const { started, issued } = await wired({ readToken: READ_TOKEN });

    const wrong = await ask(started, noncePath(), {
      authorization: `Basic ${Buffer.from(`waves:${UNKNOWN_TOKEN}`).toString("base64")}`,
    });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: "unauthorized" });
    expect(issued).toEqual([]);
  });

  it("answers 401, not 404, for an unknown decision with no credential", async () => {
    const { started } = await wired({ readToken: READ_TOKEN });

    const response = await ask(started, noncePath("absent"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("answers a tokenless ask as before when no read token is set", async () => {
    const { started } = await wired();

    const response = await ask(started, noncePath());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ nonce: "nonce-1", index: 0 });
  });
});

describe("no owner keys, no routes", () => {
  /**
   * The same request to a path under the same prefix that names no route: the
   * project and the decision exist, and only the last segment differs, so the
   * two answers can be compared byte for byte once the moving `Date` is set
   * aside.
   */
  const UNKNOWN_LAST = "absentword";

  function withoutDate(raw: string): string {
    return raw.replace(/^Date: .*$/m, "");
  }

  async function startedWithoutKeys(): Promise<Started> {
    const store = await seededStore();
    await store.appendRevision(
      PROJECT,
      ID,
      storedRevision(1, ID),
      0,
      MAX_DECISIONS_PER_PROJECT,
    );
    return startHarness({ store, readToken: READ_TOKEN });
  }

  it.each(["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])(
    "answers %s on the answer paths exactly like an unknown path",
    async (method) => {
      const started = await startedWithoutKeys();

      const nonce = withoutDate(
        await started.raw(`${method} ${noncePath()} HTTP/1.1`),
      );
      const answers = withoutDate(
        await started.raw(`${method} ${answersPath()} HTTP/1.1`),
      );
      const unknown = withoutDate(
        await started.raw(
          `${method} ${noncePath().replace("nonce", UNKNOWN_LAST)} HTTP/1.1`,
        ),
      );

      expect(nonce).toBe(unknown);
      expect(answers).toBe(unknown);
    },
  );

  it("answers an authorized read the same way too", async () => {
    const started = await startedWithoutKeys();
    const basic = `Basic ${Buffer.from(`waves:${READ_TOKEN}`).toString("base64")}`;

    const nonce = withoutDate(
      await started.raw(`GET ${noncePath()} HTTP/1.1`, [
        `Authorization: ${basic}`,
      ]),
    );
    const unknown = withoutDate(
      await started.raw(
        `GET ${noncePath().replace("nonce", UNKNOWN_LAST)} HTTP/1.1`,
        [`Authorization: ${basic}`],
      ),
    );

    expect(nonce).toBe(unknown);
  });
});
