import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { ENROLL_CEILING } from "../src/application/write-model.js";
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
const WAVE = "wv1";

for (const secret of [WRONG_TOKEN, PROJECT_TOKEN, ENROLL_TOKEN]) {
  watchSecret(secret);
}

const BEARER = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
});

function digestOf(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
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

/**
 * A clock the test moves by hand. Both service tokens share one write
 * allowance, so two registrations from one address are 1 second apart unless the
 * test says otherwise.
 */
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

async function registered(
  id = "alpha",
  token = PROJECT_TOKEN,
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

function registration(id = "beta", name = "Beta"): Record<string, unknown> {
  return { id, name, repo: `https://example.com/${id}.git` };
}

interface PostOptions {
  readonly query?: string;
  readonly token?: string;
  readonly noToken?: boolean;
}

function post(
  started: Started,
  body: unknown,
  options: PostOptions = {},
): Promise<Response> {
  return fetch(`${started.origin}${COLLECTION}${options.query ?? ""}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options.noToken === true
        ? {}
        : BEARER(options.token ?? ENROLL_TOKEN)),
    },
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

describe("what the enrollment token may do", () => {
  it("creates a project, keeps only its digest, and its token can push", async () => {
    const store = new MemoryStore();
    const tokens = minting();
    const started = await startHarness({
      store,
      enrollToken: ENROLL_TOKEN,
      mint: tokens.mint,
    });

    const response = await post(started, registration());
    const minted = tokens.issued[0] ?? "";
    watchSecret(minted);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: "beta", token: minted });
    expect(await store.getProject("beta")).toMatchObject({
      id: "beta",
      name: "Beta",
      tokenSha256: digestOf(minted),
      registeredAt: "2026-10-01T12:01:00.000Z",
    });
    const listed = await fetch(`${started.origin}${COLLECTION}`);
    expect(await listed.json()).toEqual([
      expect.objectContaining({ id: "beta", name: "Beta" }),
    ]);
    expect(JSON.stringify(await store.listProjects())).not.toContain(minted);

    const pushed = await fetch(
      `${started.origin}${COLLECTION}/beta/waves/${WAVE}`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          ...BEARER(minted),
        },
        body: JSON.stringify({
          schema: "waves/v1",
          project: "beta",
          wave: WAVE,
          generatedAt: "2026-10-01T12:00:00Z",
          intervalSeconds: 10,
          lanes: [],
        }),
      },
    );
    expect(pushed.status).toBe(200);
  });

  it("422s a registration the contract refuses, and stores nothing", async () => {
    const store = new MemoryStore();
    const started = await startHarness({
      store,
      enrollToken: ENROLL_TOKEN,
      mint: minting().mint,
    });

    const response = await post(started, { id: "beta", name: "" });

    expect(response.status).toBe(422);
    expect(await store.listProjects()).toEqual([]);
  });

  it.each([
    [
      "a key the client does not own",
      { id: "beta", name: "B", tokenSha256: "a".repeat(64) },
      0,
    ],
    ["a body that is not an object", ["beta"], 0],
    [
      "a repo that is not https",
      { id: "beta", name: "B", repo: "http://example.com" },
      1,
    ],
    ["an id the contract refuses", { id: "Beta", name: "B" }, 1],
  ])(
    "422s %s under the enrollment token, and stores nothing",
    async (_label, body, minted) => {
      const store = new MemoryStore();
      const tokens = minting();
      const started = await startHarness({
        store,
        enrollToken: ENROLL_TOKEN,
        mint: tokens.mint,
      });

      const response = await post(started, body);

      expect(response.status).toBe(422);
      expect(await store.listProjects()).toEqual([]);
      // The closed rule is what stops an enrollment from choosing its own digest
      // or its own age, and it is the same rule the admin path has: a body that
      // carries a key this service does not own is refused before a token is
      // minted at all, while one that gets as far as the contract has already
      // had a token minted and thrown away with the request.
      expect(tokens.issued).toHaveLength(minted);
    },
  );

  it("409s an id that is already registered, and mints nothing else", async () => {
    const store = await registered();
    const started = await startHarness({
      store,
      enrollToken: ENROLL_TOKEN,
      mint: minting().mint,
    });

    const response = await post(started, registration("alpha", "Renamed"));

    expect(response.status).toBe(409);
    expect(await store.getProject("alpha")).toMatchObject({
      name: "Alpha",
      tokenSha256: digestOf(PROJECT_TOKEN),
    });
  });

  it("lets exactly one of two concurrent enrollments of one id win", async () => {
    // Two servers over one store is what makes this a race: each has its own
    // limiter and its own request loop, so nothing but the store's queue stops
    // both from seeing an id that is free.
    const store = new MemoryStore();
    const tokens = minting();
    const first = await startHarness({
      store,
      enrollToken: ENROLL_TOKEN,
      mint: tokens.mint,
    });
    const second = await startHarness({
      store,
      enrollToken: ENROLL_TOKEN,
      mint: tokens.mint,
    });

    const answers = await Promise.all([
      post(first, registration()),
      post(second, registration()),
    ]);

    expect(answers.map((answer) => answer.status).sort()).toEqual([201, 409]);
    await expect(store.listProjects()).resolves.toHaveLength(1);
    expect(tokens.issued).toHaveLength(2);
  });

  it("403s a rotation, and leaves the token it would have minted unused", async () => {
    const store = await registered();
    const tokens = minting();
    const started = await startHarness({
      store,
      enrollToken: ENROLL_TOKEN,
      adminToken: ADMIN_TOKEN,
      mint: tokens.mint,
    });

    const response = await post(started, registration("alpha", "Rotated"), {
      query: "?rotate=1",
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "enrollment token cannot do this",
    });
    expect(await store.getProject("alpha")).toMatchObject({
      name: "Alpha",
      tokenSha256: digestOf(PROJECT_TOKEN),
    });
  });

  it("403s a removal, and leaves the project and its waves there", async () => {
    const store = await registered();
    await store.putSnapshot({
      envelope: {
        schema: "waves/v1",
        project: "alpha",
        wave: WAVE,
        generatedAt: "2026-10-01T12:00:00Z",
        intervalSeconds: 10,
        lanes: [],
      },
      receivedAt: "2026-10-01T12:00:01Z",
    });
    const started = await startHarness({
      store,
      enrollToken: ENROLL_TOKEN,
      adminToken: ADMIN_TOKEN,
    });

    const response = await remove(started, "alpha");

    expect(response.status).toBe(403);
    expect(await store.getProject("alpha")).toBeDefined();
    expect(await store.listSnapshots("alpha")).toHaveLength(1);
  });
});

describe("what the enrollment token cannot touch", () => {
  it("401s a push and a wave delete, as any non-project token does", async () => {
    const store = await registered();
    const started = await startHarness({
      store,
      enrollToken: ENROLL_TOKEN,
      adminToken: ADMIN_TOKEN,
    });

    const pushed = await fetch(
      `${started.origin}${COLLECTION}/alpha/waves/${WAVE}`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          ...BEARER(ENROLL_TOKEN),
        },
        body: JSON.stringify({
          schema: "waves/v1",
          project: "alpha",
          wave: WAVE,
          generatedAt: "2026-10-01T12:00:00Z",
          intervalSeconds: 10,
          lanes: [],
        }),
      },
    );
    const dropped = await fetch(
      `${started.origin}${COLLECTION}/alpha/waves/${WAVE}`,
      { method: "DELETE", headers: BEARER(ENROLL_TOKEN) },
    );

    expect([pushed.status, dropped.status]).toEqual([401, 401]);
    expect(pushed.headers.get("www-authenticate")).toBe('Bearer realm="waves"');
    expect(await store.listSnapshots("alpha")).toEqual([]);
  });

  it("401s a push even when the admin token is configured beside it", async () => {
    const store = await registered();
    const started = await startHarness({
      store,
      enrollToken: ENROLL_TOKEN,
      adminToken: ADMIN_TOKEN,
    });

    const response = await fetch(
      `${started.origin}${COLLECTION}/alpha/waves/${WAVE}`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          ...BEARER(ENROLL_TOKEN),
        },
        body: JSON.stringify({
          schema: "waves/v1",
          project: "alpha",
          wave: WAVE,
          generatedAt: "2026-10-01T12:00:00Z",
          intervalSeconds: 10,
          lanes: [],
        }),
      },
    );

    expect(response.status).toBe(401);
  });
});

describe("enrollment disabled", () => {
  it("404s a registration exactly as an unknown path does, with no Secret", async () => {
    const started = await startHarness({ store: new MemoryStore() });

    const response = await post(started, registration());

    expect(response.status).toBe(404);
    const raw = await started.raw(`POST ${COLLECTION} HTTP/1.1`, [
      "Content-Type: application/json",
      `Authorization: Bearer ${ENROLL_TOKEN}`,
      "Content-Length: 2",
    ]);
    const stranger = await started.raw("POST /api/v1/nope HTTP/1.1", [
      "Content-Type: application/json",
      `Authorization: Bearer ${ENROLL_TOKEN}`,
      "Content-Length: 2",
    ]);

    expect(raw.split("\r\n\r\n")[1]).toBe(stranger.split("\r\n\r\n")[1]);
  });

  it("401s an enrollment-shaped request when only the admin token is there", async () => {
    const started = await startHarness({
      store: await registered(),
      adminToken: ADMIN_TOKEN,
      mint: minting().mint,
    });

    const enrolled = await post(started, registration());
    const rotated = await post(started, registration(), {
      query: "?rotate=1",
    });
    const removed = await remove(started, "alpha");

    expect([enrolled.status, rotated.status, removed.status]).toEqual([
      401, 401, 401,
    ]);
  });

  it("404s a rotation and a removal, but not a registration, with only it", async () => {
    const started = await startHarness({
      store: await registered(),
      enrollToken: ENROLL_TOKEN,
      mint: minting().mint,
    });

    const plain = await post(started, registration(), { noToken: true });
    const rotated = await post(started, registration(), { query: "?rotate=1" });
    const removed = await remove(started, "alpha");

    // The whole of the risk the design accepts, stated as a test: a probe learns
    // that a second token exists, because the plain registration is refused 401
    // where the rotation is gone.
    expect([plain.status, rotated.status, removed.status]).toEqual([
      401, 404, 404,
    ]);
    expect(rotated.headers.get("www-authenticate")).toBe(null);
  });

  it("400s an unknown query on a registration with only the enrollment token", async () => {
    const started = await startHarness({
      store: await registered(),
      enrollToken: ENROLL_TOKEN,
      mint: minting().mint,
    });

    const response = await post(started, registration(), {
      query: "?rotate=2",
    });

    expect(response.status).toBe(400);
  });
});

describe("the admin token beside the enrollment one", () => {
  it.each([
    ["without an enrollment token", undefined],
    ["with one", ENROLL_TOKEN],
  ])(
    "creates, rotates and removes as it always did %s",
    async (_label, enrollToken) => {
      const store = new MemoryStore();
      const tokens = minting();
      const time = clock();
      const started = await startHarness({
        store,
        adminToken: ADMIN_TOKEN,
        enrollToken,
        mint: tokens.mint,
        now: time.now,
      });

      const created = await post(started, registration(), {
        token: ADMIN_TOKEN,
      });
      time.pass();
      const rotated = await post(started, registration("beta", "Renamed"), {
        token: ADMIN_TOKEN,
        query: "?rotate=1",
      });
      time.pass();
      const removed = await remove(started, "beta", ADMIN_TOKEN);

      expect([created.status, rotated.status, removed.status]).toEqual([
        201, 201, 204,
      ]);
      expect(await store.listProjects()).toEqual([]);
      expect(tokens.issued).toHaveLength(2);
    },
  );

  it("is still the only power that reaches a registration at the ceiling", async () => {
    const store = await filled(ENROLL_CEILING);
    const time = clock();
    const started = await startHarness({
      store,
      adminToken: ADMIN_TOKEN,
      enrollToken: ENROLL_TOKEN,
      mint: minting().mint,
      now: time.now,
    });

    const enrolled = await post(started, registration(`new-${ENROLL_CEILING}`));
    time.pass();
    const added = await post(started, registration(`other-${ENROLL_CEILING}`), {
      token: ADMIN_TOKEN,
    });

    expect([enrolled.status, added.status]).toEqual([403, 201]);
  });
});

/** A store already at the enrollment ceiling, however the projects got there. */
async function filled(count: number): Promise<MemoryStore> {
  const store = new MemoryStore();
  for (let index = 0; index < count; index += 1) {
    await store.putProject({
      id: `seed-${index}`,
      name: `Seed ${index}`,
      tokenSha256: digestOf(PROJECT_TOKEN),
      registeredAt: "2026-10-01T12:00:00Z",
    });
  }
  return store;
}

describe("leaks", () => {
  it("keeps every secret out of the log", () => {
    expect(logLeaks()).toEqual([]);
  });
});
