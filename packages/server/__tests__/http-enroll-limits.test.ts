import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import type { Digest, DigestComparer } from "../src/application/bearer.js";
import { ENROLL_CEILING } from "../src/application/write-model.js";
import { digestsEqual } from "../src/infrastructure/digest.js";
import { MemoryStore } from "../src/infrastructure/memory-store.js";
import {
  cleanupHarnesses,
  logLeaks,
  NOW_MS,
  type Started,
  startHarness,
  watchSecret,
} from "./http-harness.js";

const ADMIN_TOKEN = "admin-token-0123456789abcdefghijklmnop";
const ENROLL_TOKEN = "enroll-token-0123456789abcdefghijklmnop";
const WRONG_TOKEN = "wrong-token-0123456789abcdefghijklmnop";
const PROJECT_TOKEN = "project-token-0123456789abcdefghijklmnopq";
const COLLECTION = "/api/v1/projects";

for (const secret of [WRONG_TOKEN, PROJECT_TOKEN, ENROLL_TOKEN]) {
  watchSecret(secret);
}

const BEARER = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
});

function digestOf(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * The real comparer, counting every call. It is what makes "both digests were
 * compared" an assertion rather than a reading of the source: a handler that
 * skipped the second comparison answers `admin` and this says one.
 */
function counting(): {
  readonly compare: DigestComparer;
  readonly count: () => number;
} {
  let count = 0;
  return {
    compare: (a: Digest, b: Digest) => {
      count += 1;
      return digestsEqual(a, b);
    },
    count: () => count,
  };
}

/** A clock the test moves by hand: the shared write allowance is one a second. */
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

async function filled(
  count: number,
  token = PROJECT_TOKEN,
): Promise<MemoryStore> {
  const store = new MemoryStore();
  for (let index = 0; index < count; index += 1) {
    await store.putProject({
      id: `seed-${index}`,
      name: `Seed ${index}`,
      tokenSha256: digestOf(token),
      registeredAt: "2026-10-01T12:00:00Z",
    });
  }
  return store;
}

function registration(id: string): Record<string, unknown> {
  return { id, name: "Beta", repo: `https://example.com/${id}.git` };
}

function post(
  started: Started,
  body: unknown,
  token = ENROLL_TOKEN,
  query = "",
): Promise<Response> {
  return fetch(`${started.origin}${COLLECTION}${query}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...BEARER(token) },
    body: JSON.stringify(body),
  });
}

function remove(
  started: Started,
  id: string,
  token = ENROLL_TOKEN,
): Promise<Response> {
  return fetch(`${started.origin}${COLLECTION}/${id}`, {
    method: "DELETE",
    headers: BEARER(token),
  });
}

afterEach(cleanupHarnesses);

describe("both digests are compared", () => {
  it.each([
    ["the admin token", ADMIN_TOKEN],
    ["the enrollment token", ENROLL_TOKEN],
    ["a token that is neither", WRONG_TOKEN],
  ])(
    "compares against both configured digests for %s",
    async (_label, token) => {
      const counted = counting();
      const time = clock();
      const started = await startHarness({
        store: new MemoryStore(),
        adminToken: ADMIN_TOKEN,
        enrollToken: ENROLL_TOKEN,
        compare: counted.compare,
        now: time.now,
      });

      await post(started, registration("beta"), token);

      // Exactly two, in both directions: which of the two is presented decides
      // nothing about how many comparisons happen.
      expect(counted.count()).toBe(2);
    },
  );

  it("compares both on a removal too", async () => {
    const counted = counting();
    const started = await startHarness({
      store: await filled(1),
      adminToken: ADMIN_TOKEN,
      enrollToken: ENROLL_TOKEN,
      compare: counted.compare,
    });

    await remove(started, "seed-0");

    expect(counted.count()).toBe(2);
  });

  it("compares against every stored project digest, and neither of its own, on a push", async () => {
    const counted = counting();
    const time = clock();
    const started = await startHarness({
      store: await filled(3),
      adminToken: ADMIN_TOKEN,
      enrollToken: ENROLL_TOKEN,
      compare: counted.compare,
      now: time.now,
    });

    await fetch(`${started.origin}${COLLECTION}/seed-0/waves/wv1`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...BEARER(PROJECT_TOKEN),
      },
      body: JSON.stringify({
        schema: "waves/v1",
        project: "seed-0",
        wave: "wv1",
        generatedAt: "2026-10-01T12:00:00Z",
        intervalSeconds: 10,
        lanes: [],
      }),
    });

    // One per stored project and no service token: the project-write path is
    // not changed by the enrollment one.
    expect(counted.count()).toBe(3);
  });
});

describe("the enrollment ceiling", () => {
  it("403s past it, eleven times over, and never locks the address out", async () => {
    const store = await filled(ENROLL_CEILING);
    const time = clock();
    const started = await startHarness({
      store,
      adminToken: ADMIN_TOKEN,
      enrollToken: ENROLL_TOKEN,
      now: time.now,
    });

    const answers: number[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      time.pass();
      answers.push((await post(started, registration("late"))).status);
    }

    // Not one of them is a 429: the ceiling is not a failed authentication, so
    // it is not charged to the address and it cannot be used to lock anyone out.
    expect(answers).toEqual(Array.from({ length: 11 }, () => 403));
    time.pass();
    const refused = await post(started, registration("late"));
    expect(await refused.json()).toEqual({
      error: "enrollment ceiling reached",
    });
    expect(refused.headers.get("www-authenticate")).toBe(null);
    expect(await store.listProjects()).toHaveLength(ENROLL_CEILING);
  });

  it("still lets the admin token register past it", async () => {
    const store = await filled(ENROLL_CEILING);
    const time = clock();
    const started = await startHarness({
      store,
      adminToken: ADMIN_TOKEN,
      enrollToken: ENROLL_TOKEN,
      now: time.now,
    });

    const refused = await post(started, registration("late"));
    time.pass();
    const allowed = await post(started, registration("late"), ADMIN_TOKEN);

    expect([refused.status, allowed.status]).toEqual([403, 201]);
    await expect(store.getProject("late")).resolves.toMatchObject({
      id: "late",
    });
  });
});

describe("the two allowances", () => {
  it("keeps the admin token's cleanup open while the enrollment token spends its own", async () => {
    const store = await filled(1);
    const started = await startHarness({
      store,
      adminToken: ADMIN_TOKEN,
      enrollToken: ENROLL_TOKEN,
    });

    // One clock second: the enrollment token takes its one write, then asks
    // again and is held; the admin token's removal in the same second is not.
    const enrolled = await post(started, registration("beta"));
    const held = await post(started, registration("gamma"));
    const removed = await remove(started, "seed-0", ADMIN_TOKEN);

    expect([enrolled.status, held.status, removed.status]).toEqual([
      201, 429, 204,
    ]);
    expect(await held.json()).toEqual({ error: "too many writes" });
  });
});

describe("both refusals are charged", () => {
  it("429s the eleventh deletion under the enrollment token", async () => {
    const store = await filled(1);
    const time = clock();
    const started = await startHarness({
      store,
      adminToken: ADMIN_TOKEN,
      enrollToken: ENROLL_TOKEN,
      now: time.now,
    });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      time.pass();
      expect((await remove(started, "seed-0")).status).toBe(403);
    }
    time.pass();
    const locked = await remove(started, "seed-0");

    expect(locked.status).toBe(429);
    expect(await locked.json()).toEqual({ error: "too many failures" });
    await expect(store.getProject("seed-0")).resolves.toBeDefined();
  });

  it("429s the eleventh rotation under the enrollment token", async () => {
    const store = await filled(1);
    const time = clock();
    const started = await startHarness({
      store,
      adminToken: ADMIN_TOKEN,
      enrollToken: ENROLL_TOKEN,
      now: time.now,
    });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      time.pass();
      expect(
        (await post(started, registration("seed-0"), ENROLL_TOKEN, "?rotate=1"))
          .status,
      ).toBe(403);
    }
    time.pass();
    const locked = await post(
      started,
      registration("seed-0"),
      ADMIN_TOKEN,
      "?rotate=1",
    );

    // Both 403s cost the same as the 401s do: a caller that keeps asking for
    // something it may not have spends the allowance as fast as one guessing.
    expect(locked.status).toBe(429);
  });
});

describe("what an enrollment logs", () => {
  it("names the id and never the token or its digest", async () => {
    const started = await startHarness({
      store: new MemoryStore(),
      enrollToken: ENROLL_TOKEN,
      mint: () => PROJECT_TOKEN,
    });

    await post(started, registration("beta"));

    const written = started.logLines().join("\n");
    const enrolled = started
      .logLines()
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => line.event === "enrolled");
    expect(enrolled).toEqual([
      {
        ts: new Date(NOW_MS).toISOString(),
        event: "enrolled",
        project: "beta",
      },
    ]);
    for (const secret of [
      ENROLL_TOKEN,
      PROJECT_TOKEN,
      digestOf(ENROLL_TOKEN),
      digestOf(PROJECT_TOKEN),
    ]) {
      expect(written).not.toContain(secret);
    }
    expect(logLeaks()).toEqual([]);
  });

  it("logs nothing for a registration the admin token made", async () => {
    const time = clock();
    const started = await startHarness({
      store: new MemoryStore(),
      adminToken: ADMIN_TOKEN,
      enrollToken: ENROLL_TOKEN,
      mint: () => PROJECT_TOKEN,
      now: time.now,
    });

    const registered = await post(started, registration("beta"), ADMIN_TOKEN);
    time.pass();
    const enrolled = await post(started, registration("gamma"));

    expect([registered.status, enrolled.status]).toEqual([201, 201]);
    const events = started
      .logLines()
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => line.event === "enrolled");
    expect(events).toEqual([
      {
        ts: new Date(NOW_MS + 1_000).toISOString(),
        event: "enrolled",
        project: "gamma",
      },
    ]);
  });

  it("logs nothing for a refusal", async () => {
    const started = await startHarness({
      store: await filled(1),
      enrollToken: ENROLL_TOKEN,
      adminToken: ADMIN_TOKEN,
    });

    await post(started, registration("late"), ENROLL_TOKEN, "?rotate=1");
    await post(started, registration("beta"), WRONG_TOKEN);

    expect(
      started.logLines().filter((line) => line.includes('"event"')),
    ).toEqual([]);
  });
});
