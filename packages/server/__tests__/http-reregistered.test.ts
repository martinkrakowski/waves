import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import {
  decisionBindingText,
  type DecisionRevision,
  type Envelope,
} from "@hexagen-monaco/waves-contract";

import { MemoryStore } from "../src/infrastructure/memory-store.js";
import { sha256Hex } from "../src/infrastructure/sha256.js";
import {
  cleanupHarnesses,
  logLeaks,
  NOW_MS,
  startHarness,
  type Started,
} from "./http-harness.js";
import { decisionRevision, stateEntryRequest } from "./notice-contract.js";

const PROJECT_TOKEN = "project-token-0123456789abcdefghijklmnopq";
const OTHER_TOKEN = "other-token-0123456789abcdefghijklmnopqr";

const BEARER = (token: string) => ({ authorization: `Bearer ${token}` });

function digestOf(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

const PROJECT = "alpha";
const ID = "d1";
const WAVE = "wv1";

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
function wavePath(wave = WAVE, project = PROJECT): string {
  return `/api/v1/projects/${project}/waves/${wave}`;
}
function statusPath(project = PROJECT): string {
  return `/api/v1/projects/${project}/status`;
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

function eventBody(project = PROJECT) {
  return {
    schema: "waves-notice/v1",
    kind: "event",
    project,
    topic: "relay",
    text: "Round 3 sent to five sessions",
    at: "2026-10-08T13:00:00Z",
  };
}

function envelope(wave = WAVE, project = PROJECT): Envelope {
  return {
    schema: "waves/v1",
    project,
    wave,
    generatedAt: "2026-10-01T12:00:00Z",
    intervalSeconds: 10,
    lanes: [{ id: `${wave}-a`, derived: { alive: true }, disagreements: [] }],
  };
}

function statusDocument(project = PROJECT) {
  return {
    schema: "waves-status/v1",
    project,
    generatedAt: "2026-10-01T12:00:00Z",
    intervalSeconds: 10,
    prs: { skipped: 2 },
    backlog: {
      state: "recorded",
      at: "2026-10-01T11:55:00Z",
      scope: { kind: "full", plans: ["plan:verify"] },
      git: { branch: "main", head: "0a1b2c3d4e5f60718293a4b5c6d7e8f9" },
      premises: [{ lane: "C1", plan: "plan:verify", status: "holds" }],
    },
  };
}

/**
 * A MemoryStore whose NEXT `listProjects` answers the old registry and then,
 * before it returns, replaces `id`'s registration: what a delete and a
 * re-registration between the token check and the write look like.
 */
class SwappingStore extends MemoryStore {
  swap: (() => Promise<void>) | undefined;

  override async listProjects() {
    const before = await super.listProjects();
    const swap = this.swap;
    this.swap = undefined;
    if (swap !== undefined) {
      await swap();
    }
    return before;
  }
}

/** The swap for "deleted and registered again under the same id". */
function reregister(store: SwappingStore): void {
  store.swap = async () => {
    await store.deleteProject(PROJECT);
    await store.createProject(
      {
        id: PROJECT,
        name: "again",
        tokenSha256: digestOf(OTHER_TOKEN),
        registeredAt: "2026-10-02T00:00:00.000Z",
      },
      10,
    );
  };
}

async function wired(): Promise<{
  started: Started;
  store: SwappingStore;
  pass: () => void;
}> {
  const store = new SwappingStore();
  await store.putProject({
    id: PROJECT,
    name: "Alpha",
    repo: "https://example.com/alpha.git",
    tokenSha256: digestOf(PROJECT_TOKEN),
    registeredAt: "2026-10-01T12:00:00Z",
  });
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

afterEach(() => cleanupHarnesses().then(() => expect(logLeaks()).toEqual([])));

describe("a write whose registration is swapped after authentication", () => {
  it("401s an event POST and stores nothing", async () => {
    const { started, store } = await wired();
    reregister(store);

    const response = await json(started, "POST", EVENTS_PATH, eventBody());

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer realm="waves"',
    );
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(await store.listEvents(PROJECT, 10)).toEqual([]);
  });

  it("401s a decision PUT and stores no decision", async () => {
    const { started, store } = await wired();
    reregister(store);

    const response = await json(started, "PUT", decisionPath(), decisionBody());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(await store.listDecisions(PROJECT)).toEqual([]);
  });

  it("401s a state POST on a decision the old registration raised, and adds no entry", async () => {
    const { started, store, pass } = await wired();
    const raised = await json(started, "PUT", decisionPath(), decisionBody());
    expect(raised.status).toBe(200);
    pass();
    reregister(store);

    const response = await json(
      started,
      "POST",
      statesPath(),
      stateEntryRequest({
        revision: 1,
        textSha256: BINDING_HASH(),
        expectedEntries: 0,
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect((await store.getDecision(PROJECT, ID))?.entries).toEqual([]);
  });

  it("401s a wave PUT and stores no snapshot", async () => {
    const { started, store } = await wired();
    reregister(store);

    const response = await json(started, "PUT", wavePath(), envelope());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(await store.listSnapshots(PROJECT)).toEqual([]);
  });

  it("401s a status PUT and stores no status", async () => {
    const { started, store } = await wired();
    reregister(store);

    const response = await json(
      started,
      "PUT",
      statusPath(),
      statusDocument(),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(await store.getStatus(PROJECT)).toBeUndefined();
  });

  it("401s a wave DELETE and leaves the new registration's snapshot in place", async () => {
    const { started, store } = await wired();
    store.swap = async () => {
      await store.deleteProject(PROJECT);
      await store.createProject(
        {
          id: PROJECT,
          name: "again",
          tokenSha256: digestOf(OTHER_TOKEN),
          registeredAt: "2026-10-02T00:00:00.000Z",
        },
        10,
      );
      await store.putSnapshot({
        envelope: envelope(),
        receivedAt: "2026-10-02T00:00:00.000Z",
      });
    };

    const response = await fetch(`${started.origin}${wavePath()}`, {
      method: "DELETE",
      headers: BEARER(PROJECT_TOKEN),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(await store.listSnapshots(PROJECT)).toHaveLength(1);
  });

  it("401s an event POST to a project that was deleted and not registered again", async () => {
    const { started, store } = await wired();
    store.swap = async () => {
      await store.deleteProject(PROJECT);
    };

    const response = await json(started, "POST", EVENTS_PATH, eventBody());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(await store.listEvents(PROJECT, 10)).toEqual([]);
  });

  it("401s an event POST from a token that was rotated away", async () => {
    const { started, store } = await wired();
    store.swap = async () => {
      await store.putProject({
        id: PROJECT,
        name: "Alpha",
        repo: "https://example.com/alpha.git",
        tokenSha256: digestOf(OTHER_TOKEN),
        registeredAt: "2026-10-01T12:00:00Z",
      });
    };

    const response = await json(started, "POST", EVENTS_PATH, eventBody());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(await store.listEvents(PROJECT, 10)).toEqual([]);
  });
});

describe("the same write with no registry change", () => {
  it("answers 201 and stores the event, so the refusals above fail for the right reason", async () => {
    const { started, store } = await wired();

    const response = await json(started, "POST", EVENTS_PATH, eventBody());

    expect(response.status).toBe(201);
    expect(await store.listEvents(PROJECT, 10)).toHaveLength(1);
  });

  it("finishes two project writes that are in flight at once", async () => {
    const { started, store } = await wired();
    await store.putProject({
      id: "beta",
      name: "Beta",
      repo: "https://example.com/beta.git",
      tokenSha256: digestOf(OTHER_TOKEN),
      registeredAt: "2026-10-01T12:00:00Z",
    });

    const [eventResponse, statusResponse] = await Promise.all([
      json(started, "POST", EVENTS_PATH, eventBody()),
      json(
        started,
        "PUT",
        statusPath("beta"),
        statusDocument("beta"),
        OTHER_TOKEN,
      ),
    ]);

    expect(eventResponse.status).toBe(201);
    expect(statusResponse.status).toBe(200);
  });
});
