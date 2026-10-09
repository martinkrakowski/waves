import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import {
  decisionBindingText,
  type DecisionRevision,
} from "@hexagen-monaco/waves-contract";

import { MemoryStore } from "../src/index.js";
import { sha256Hex } from "../src/infrastructure/sha256.js";
import {
  cleanupHarnesses,
  finalStatus,
  logLeaks,
  NOW_MS,
  startHarness,
  type Started,
} from "./http-harness.js";
import {
  decisionRevision,
  stateEntryRequest,
  storedRevision,
} from "./notice-contract.js";

const PROJECT_TOKEN = "project-token-0123456789abcdefghijklmnopq";
const OTHER_TOKEN = "other-token-0123456789abcdefghijklmnopqr";
const UNKNOWN_TOKEN = "unknown-token-0123456789abcdefghijklmno";

const BEARER = (token: string) => ({ authorization: `Bearer ${token}` });

function digestOf(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

const PROJECT = "alpha";
const ID = "d1";

function decisionBody(overrides: Partial<DecisionRevision> = {}) {
  return decisionRevision(ID, PROJECT, overrides);
}

const BINDING_HASH = () => sha256Hex(decisionBindingText(decisionBody()));

function decisionPath(id = ID): string {
  return `/api/v1/projects/${PROJECT}/decisions/${id}`;
}
function statesPath(id = ID): string {
  return `/api/v1/projects/${PROJECT}/decisions/${id}/states`;
}
const EVENTS_PATH = `/api/v1/projects/${PROJECT}/events`;

function clock() {
  let at = NOW_MS;
  return {
    now: () => at,
    pass: () => {
      at += 1_000;
    },
  };
}

async function seedProject(
  id = PROJECT,
  token = PROJECT_TOKEN,
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

async function wired(token = PROJECT_TOKEN): Promise<{
  started: Started;
  store: MemoryStore;
  pass: () => void;
}> {
  const store = await seedProject(PROJECT, token);
  const clk = clock();
  return {
    started: await startHarness({ store, now: clk.now }),
    store,
    pass: clk.pass,
  };
}

async function json(
  started: Started,
  method: string,
  path: string,
  body: unknown,
  token = PROJECT_TOKEN,
): Promise<Response> {
  return fetch(`${started.origin}${path}`, {
    method,
    headers: { "content-type": "application/json", ...BEARER(token) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function stateEntry(
  overrides: Partial<Parameters<typeof stateEntryRequest>[0]> = {},
) {
  return stateEntryRequest({
    revision: 1,
    textSha256: BINDING_HASH(),
    expectedEntries: 0,
    ...overrides,
  });
}

afterEach(() => cleanupHarnesses().then(() => expect(logLeaks()).toEqual([])));

describe("raising a decision", () => {
  it("stores revision 1 and returns the hash, created and entry count", async () => {
    const { started } = await wired();
    const response = await json(started, "PUT", decisionPath(), decisionBody());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(await response.json()).toEqual({
      revision: 1,
      textSha256: BINDING_HASH(),
      created: true,
      entries: 0,
    });
  });

  it("answers created:false and makes no revision on a repeat PUT", async () => {
    const { started, store, pass } = await wired();
    await json(started, "PUT", decisionPath(), decisionBody());
    pass();

    const response = await json(started, "PUT", decisionPath(), decisionBody());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      revision: 1,
      textSha256: BINDING_HASH(),
      created: false,
      entries: 0,
    });
    expect((await store.getDecision(PROJECT, ID))?.revisions).toHaveLength(1);
  });

  it("makes revision 2 with the SAME hash when only evidence changes", async () => {
    const { started, pass } = await wired();
    await json(started, "PUT", decisionPath(), decisionBody());
    pass();

    const response = await json(
      started,
      "PUT",
      decisionPath(),
      decisionBody({
        evidence: [{ label: "PR 7", href: "https://x.example/7" }],
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      revision: 2,
      textSha256: BINDING_HASH(),
      created: true,
      entries: 0,
    });
  });

  it("makes a revision with a different hash when the question changes", async () => {
    const { started, pass } = await wired();
    await json(started, "PUT", decisionPath(), decisionBody());
    pass();
    const changed = decisionBody({ question: "New question?" });

    const response = await json(started, "PUT", decisionPath(), changed);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      revision: 2,
      textSha256: sha256Hex(decisionBindingText(changed)),
      created: true,
      entries: 0,
    });
  });

  it("400s an invalid body with the contract's issues", async () => {
    const { started } = await wired();
    const response = await json(started, "PUT", decisionPath(), {
      schema: "waves/v2",
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { errors: { path: string }[] };
    expect(body.errors.map((e) => e.path)).toContain("/schema");
  });

  it("400s a body whose project or id is not the path's", async () => {
    const { started, pass } = await wired();
    pass();

    const projectMismatch = await json(
      started,
      "PUT",
      decisionPath(),
      decisionRevision(ID, "beta"),
    );
    pass();
    const idMismatch = await json(
      started,
      "PUT",
      decisionPath(),
      decisionRevision("other", PROJECT),
    );

    expect(projectMismatch.status).toBe(400);
    expect(await projectMismatch.json()).toEqual({
      errors: [
        { path: "/project", message: "expected the project the path names" },
      ],
    });
    expect(idMismatch.status).toBe(400);
    expect(await idMismatch.json()).toEqual({
      errors: [{ path: "/id", message: "expected the id the path names" }],
    });
  });

  it("404s a decision id the contract refuses", async () => {
    const { started, pass } = await wired();
    pass();

    const response = await json(
      started,
      "PUT",
      `/api/v1/projects/${PROJECT}/decisions/bad id`,
      decisionRevision("d1", PROJECT),
    );
    expect(response.status).toBe(404);
  });
});

describe("posting a state entry", () => {
  async function raised() {
    const wiredResult = await wired();
    await json(wiredResult.started, "PUT", decisionPath(), decisionBody());
    wiredResult.pass();
    return wiredResult;
  }

  it("returns 201 with the entry index", async () => {
    const { started } = await raised();
    const response = await json(started, "POST", statesPath(), stateEntry());

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ index: 0 });
  });

  it("404s a state on a decision that does not exist", async () => {
    const { started } = await raised();
    const response = await json(
      started,
      "POST",
      statesPath("absent"),
      stateEntry(),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not found" });
  });

  it.each([
    ["a stale revision", { revision: 2 }],
    ["a stale textSha256", { textSha256: "1".repeat(64) }],
    ["a stale expectedEntries", { expectedEntries: 5 }],
  ])(
    "reports %s (rule 2) as a 409 with the current trio",
    async (_label, bad) => {
      const { started } = await raised();
      const response = await json(
        started,
        "POST",
        statesPath(),
        stateEntry(bad),
      );

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: "the state entry is out of date",
        revision: 1,
        textSha256: BINDING_HASH(),
        entries: 0,
      });
    },
  );

  it("refuses rule 1: an answer state sent by a session is a 400", async () => {
    const { started } = await raised();
    const response = await json(
      started,
      "POST",
      statesPath(),
      stateEntry({ state: "approved", source: "session" }),
    );

    expect(response.status).toBe(400);
  });

  it("refuses an option that is not a key of the current revision", async () => {
    const { started } = await raised();
    const response = await json(
      started,
      "POST",
      statesPath(),
      stateEntry({ option: "z" }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].path).toBe("/option");
  });

  it("refuses a supersededBy that is not another decision of the project", async () => {
    const { started } = await raised();
    const response = await json(
      started,
      "POST",
      statesPath(),
      stateEntry({
        state: "superseded",
        source: "session",
        supersededBy: "missing",
      }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].path).toBe("/supersededBy");
  });

  it("400s an invalid state entry body", async () => {
    const { started } = await raised();
    const response = await json(started, "POST", statesPath(), { schema: "x" });
    expect(response.status).toBe(400);
  });
});

describe("posting an event", () => {
  it("returns 201 with its id and dropped count", async () => {
    const { started } = await wired();
    const response = await json(started, "POST", EVENTS_PATH, {
      schema: "waves-notice/v1",
      kind: "event",
      project: PROJECT,
      topic: "relay",
      text: "Round 3 sent to five sessions",
      at: "2026-10-08T13:00:00Z",
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      id: `${new Date(NOW_MS).toISOString()}-1`,
      dropped: 0,
    });
  });

  it("400s an event whose project is not the path's", async () => {
    const { started } = await wired();
    const response = await json(started, "POST", EVENTS_PATH, {
      schema: "waves-notice/v1",
      kind: "event",
      project: "beta",
      topic: "relay",
      text: "x",
      at: "2026-10-08T13:00:00Z",
    });
    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].path).toBe("/project");
  });

  it("400s an invalid event body", async () => {
    const { started } = await wired();
    const response = await json(started, "POST", EVENTS_PATH, { schema: "x" });
    expect(response.status).toBe(400);
  });
});

describe("auth and framing for the notice writes", () => {
  it.each([
    ["no token at all", undefined],
    ["an unknown token", BEARER(UNKNOWN_TOKEN)],
  ])("401s %s on a notice write", async (_label, auth) => {
    const { started, pass } = await wired();
    pass();

    const response = await fetch(`${started.origin}${decisionPath()}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...(auth as Record<string, string> | undefined),
      },
      body: JSON.stringify(decisionBody()),
    });

    expect(response.status).toBe(401);
  });

  it("refuses another project's token on every notice write route", async () => {
    const { started, store, pass } = await wired();
    // Register a second project with OTHER_TOKEN so the token is known but
    // foreign: it must be refused (403) on alpha's three notice write routes,
    // not answered as an unknown token (401).
    await store.putProject({
      id: "beta",
      name: "Beta",
      repo: "https://example.com/beta.git",
      tokenSha256: digestOf(OTHER_TOKEN),
      registeredAt: "2026-10-01T12:00:00Z",
    });
    pass();

    const token = OTHER_TOKEN;
    const put = await json(
      started,
      "PUT",
      decisionPath(),
      decisionBody(),
      token,
    );
    expect(put.status).toBe(403);

    const postState = await json(
      started,
      "POST",
      statesPath(),
      stateEntry(),
      token,
    );
    expect(postState.status).toBe(403);

    const postEvent = await json(
      started,
      "POST",
      EVENTS_PATH,
      {
        schema: "waves-notice/v1",
        kind: "event",
        project: PROJECT,
        topic: "relay",
        text: "Round 3 sent to five sessions",
        at: "2026-10-08T13:00:00Z",
      },
      token,
    );
    expect(postEvent.status).toBe(403);
  });

  it("429s the second write to a project within a second", async () => {
    const { started } = await wired();
    await json(started, "PUT", decisionPath(), decisionBody());

    const response = await json(started, "PUT", decisionPath(), decisionBody());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("1");
  });

  it("405s off-route methods and 404s a bad id", async () => {
    const { started, pass } = await wired();
    pass();

    const del = await json(started, "DELETE", decisionPath(), undefined);
    expect(del.status).toBe(405);
    expect(del.headers.get("allow")).toBe("GET, HEAD, PUT");

    const post = await json(started, "POST", decisionPath(), undefined);
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD, PUT");
  });

  it("refuses a notice write that carries an Origin", async () => {
    const { started, pass } = await wired();
    pass();

    const response = await fetch(`${started.origin}${decisionPath()}`, {
      method: "PUT",
      headers: {
        ...BEARER(PROJECT_TOKEN),
        origin: "https://waves.example.invalid",
      },
      body: JSON.stringify(decisionBody()),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "cross-origin writes refused",
    });
  });
});

describe("notice ids do not collide with waves", () => {
  it("stores a decision whose id is a word the route treats as a literal", async () => {
    const { started, pass } = await wired();
    pass();

    const response = await json(
      started,
      "PUT",
      decisionPath("events"),
      decisionRevision("events", PROJECT),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).revision).toBe(1);
  });
});

describe("notice write framing", () => {
  function chunked(payload: string): string {
    const hex = payload.length.toString(16);
    return `${hex}\r\n${payload}\r\n0\r\n\r\n`;
  }

  it.each([
    ["PUT a decision", "PUT", decisionPath()],
    ["POST a state", "POST", statesPath()],
    ["POST an event", "POST", EVENTS_PATH],
  ])("400s a body that is not json on %s", async (_label, method, path) => {
    const { started, pass } = await wired();
    pass();
    const raw = await started.raw(
      `${method} ${path} HTTP/1.1`,
      [
        "Content-Type: application/json",
        `Authorization: Bearer ${PROJECT_TOKEN}`,
        "Content-Length: 7",
        "Connection: close",
      ],
      "{ not ]",
    );
    expect(finalStatus(raw)).toBe("HTTP/1.1 400");
    expect(raw).toContain('{"error":"bad json"}');
  });

  it.each([
    ["POST a state", "POST", statesPath(), 16_384],
    ["POST an event", "POST", EVENTS_PATH, 16_384],
    ["PUT a decision", "PUT", decisionPath(), 1_048_576],
  ])(
    "413s a chunked body past the cap on %s",
    async (_label, method, path, cap) => {
      const { started, pass } = await wired();
      pass();
      const over = chunked("x".repeat(cap + 1));
      const raw = await started.raw(
        `${method} ${path} HTTP/1.1`,
        [
          "Content-Type: application/json",
          `Authorization: Bearer ${PROJECT_TOKEN}`,
          "Transfer-Encoding: chunked",
          "Connection: close",
        ],
        over,
      );
      expect(finalStatus(raw)).toBe("HTTP/1.1 413");
    },
  );
});

describe("unknown project reads", () => {
  it("answers 404 where a registered project answers 200", async () => {
    const { started } = await wired();

    const registered = await fetch(
      `${started.origin}/api/v1/projects/${PROJECT}/decisions`,
    );
    expect(registered.status).toBe(200);

    for (const path of [
      "/api/v1/projects/absent/decisions",
      "/api/v1/projects/absent/decisions/absent",
      "/api/v1/projects/absent/events",
    ]) {
      expect((await fetch(`${started.origin}${path}`)).status).toBe(404);
    }
  });

  it("serves 404 for a decision file planted under an unregistered project", async () => {
    const { started, store } = await wired();
    await store.appendRevision("absent", "d1", storedRevision(1, "d1"), 0, 3);
    const res = await fetch(
      `${started.origin}/api/v1/projects/absent/decisions/d1`,
    );
    expect(res.status).toBe(404);
  });
});
