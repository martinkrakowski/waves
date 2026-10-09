import { afterEach, describe, expect, it } from "vitest";

import {
  NOTICE_DECISIONS,
  type NoticeFixture,
} from "../../contract/__tests__/fixtures/notice-decisions.js";

import type { Head } from "../src/application/notice-read-model.js";
import {
  cleanupHarnesses,
  NOW_MS,
  startHarness,
  type Started,
} from "./http-harness.js";

const ADMIN_TOKEN = "admin-token-0123456789abcdefghijklmnopqr";
const BEARER = (token: string) => ({ authorization: `Bearer ${token}` });

const PROJECTS = [
  "hexagen-monaco",
  "campaign-foundry",
  "gate-lock",
  "fleet",
  "client-portal",
  "waves",
] as const;

const NAMES: Record<string, string> = {
  "hexagen-monaco": "Hexagen Monaco",
  "campaign-foundry": "Campaign Foundry",
  "gate-lock": "Gate Lock",
  fleet: "Fleet",
  "client-portal": "Client Portal",
  waves: "Waves",
};

function clock() {
  let at = NOW_MS;
  return {
    now: () => at,
    pass: () => {
      at += 1_000;
    },
  };
}

function basePath(project: string): string {
  return `/api/v1/projects/${project}/decisions`;
}

interface PutResult {
  revision: number;
  textSha256: string;
  entries: number;
}

async function putDecision(
  started: Started,
  token: string,
  project: string,
  id: string,
  body: unknown,
  pass: () => void,
): Promise<PutResult> {
  pass();
  const res = await fetch(`${started.origin}${basePath(project)}/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...BEARER(token) },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as PutResult;
}

async function postState(
  started: Started,
  token: string,
  project: string,
  id: string,
  body: unknown,
  pass: () => void,
): Promise<number> {
  pass();
  const res = await fetch(
    `${started.origin}${basePath(project)}/${id}/states`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...BEARER(token) },
      body: JSON.stringify(body),
    },
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { index: number }).index;
}

async function postEvent(
  started: Started,
  token: string,
  project: string,
  topic: string,
  pass: () => void,
): Promise<void> {
  pass();
  const res = await fetch(
    `${started.origin}/api/v1/projects/${project}/events`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...BEARER(token) },
      body: JSON.stringify({
        schema: "waves-notice/v1",
        kind: "event",
        project,
        topic,
        text: topic,
        at: "2026-10-08T13:00:00Z",
      }),
    },
  );
  expect(res.status).toBe(201);
}

async function registerAll(
  started: Started,
  pass: () => void,
): Promise<Record<string, string>> {
  const tokens: Record<string, string> = {};
  for (const project of PROJECTS) {
    pass();
    const res = await fetch(`${started.origin}/api/v1/projects`, {
      method: "POST",
      headers: { "content-type": "application/json", ...BEARER(ADMIN_TOKEN) },
      body: JSON.stringify({ id: project, name: NAMES[project] }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; token: string };
    tokens[project] = body.token;
  }
  return tokens;
}

async function loadFixture(
  started: Started,
  tokens: Record<string, string>,
  fixture: NoticeFixture,
  pass: () => void,
): Promise<void> {
  const project = fixture.project;
  const token = tokens[project]!;
  let entryCount = 0;
  const hashes = new Map<number, string>();
  for (const revision of fixture.revisions) {
    const { revision: number, textSha256 } = await putDecision(
      started,
      token,
      project,
      fixture.id,
      revision,
      pass,
    );
    hashes.set(number, textSha256);
    for (const state of fixture.states.filter((s) => s.revision === number)) {
      entryCount =
        (await postState(
          started,
          token,
          project,
          fixture.id,
          {
            ...state,
            textSha256: hashes.get(number),
            expectedEntries: entryCount,
          },
          pass,
        )) + 1;
    }
  }
}

async function loaded(): Promise<Started> {
  const clk = clock();
  const started = await startHarness({
    adminToken: ADMIN_TOKEN,
    now: clk.now,
  });
  const tokens = await registerAll(started, clk.pass);
  for (const fixture of NOTICE_DECISIONS) {
    await loadFixture(started, tokens, fixture, clk.pass);
  }
  return started;
}

const COUNTS: Record<string, [number, number, number, number]> = {
  "hexagen-monaco": [1, 1, 1, 0],
  "campaign-foundry": [3, 1, 0, 0],
  "gate-lock": [2, 0, 0, 0],
  fleet: [2, 1, 2, 0],
  "client-portal": [2, 0, 0, 0],
  waves: [1, 0, 0, 0],
};

afterEach(() => cleanupHarnesses());

function find(heads: Head[], id: string): Head {
  const h = heads.find((x) => x.id === id);
  expect(h, `decision ${id}`).toBeDefined();
  return h as Head;
}

describe("the fourteen fixtures", () => {
  it("produce the per-project inbox counts", async () => {
    const started = await loaded();
    const res = await fetch(`${started.origin}/api/v1/inbox`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      projects: Array<{
        id: string;
        counts: {
          waiting: number;
          oneWay: number;
          reported: number;
          closed: number;
        };
      }>;
    };
    const byCounts = new Map(body.projects.map((p) => [p.id, p.counts]));
    for (const project of PROJECTS) {
      const expected = COUNTS[project]! as [number, number, number, number];
      expect(byCounts.get(project)).toEqual({
        waiting: expected[0],
        oneWay: expected[1],
        reported: expected[2],
        closed: expected[3],
      });
    }
  });

  it("shows the named decisions", async () => {
    const started = await loaded();
    const res = await fetch(`${started.origin}/api/v1/inbox`);
    const { projects } = (await res.json()) as {
      projects: Array<{ id: string; decisions: Head[] }>;
    };
    const byId = new Map(projects.map((p) => [p.id, p]));
    const fleet = byId.get("fleet");
    expect(fleet).toBeDefined();
    const fleetHeads = fleet!.decisions;
    const gateLock = byId.get("gate-lock");
    expect(gateLock).toBeDefined();
    const gateHeads = gateLock!.decisions;

    const backup = find(fleetHeads, "backup-job-in-freeze");
    expect(backup.group).toBe("waiting");
    expect(backup.state).toBe("open");

    const hold = find(fleetHeads, "test-db-switch-hold");
    expect(hold.group).toBe("reported");
    expect(hold.state).toBe("approved");
    expect(hold.entries).toBe(2);

    const give = find(gateHeads, "give-up-bound");
    expect(give.revision).toBe(2);
    expect(give.state).toBe("delegated");

    const wavesRes = await fetch(
      `${started.origin}/api/v1/projects/waves/decisions`,
    );
    const wavesDecisions = (await wavesRes.json()) as { decisions: Head[] };
    const clean = find(wavesDecisions.decisions, "clean-merged-worktrees");
    expect(clean.from).toBe("fleet");
  });
});

interface CountBody {
  waiting: number;
  oneWay: number;
  reported: number;
  closed: number;
}

function decision(project: string, id: string) {
  return {
    schema: "waves-notice/v1",
    kind: "decision",
    project,
    id,
    shape: "choice",
    question: "Go?",
    options: [
      { key: "a", text: "Yes", cost: "c" },
      { key: "b", text: "No", cost: "c" },
    ],
    hardToUndo: { value: "partly", reason: "byte-for-byte <reason>" },
    commits: [],
    decider: "owner",
    appliesTo: [],
    evidence: [],
    raisedBy: "session",
    raisedAt: "2026-10-08T12:00:00Z",
  } as const;
}

describe("rule 1: a reported answer leaves the decision in the inbox", () => {
  it("moves waiting down by one and reported up by one", async () => {
    const clk = clock();
    const started = await startHarness({
      adminToken: ADMIN_TOKEN,
      now: clk.now,
    });
    const tokens = await registerAll(started, clk.pass);
    const token = tokens.fleet!;
    const body = decision("fleet", "d1");
    const { textSha256 } = await putDecision(
      started,
      token,
      "fleet",
      "d1",
      body,
      clk.pass,
    );

    const before = (await fetch(`${started.origin}/api/v1/projects`).then((r) =>
      r.json(),
    )) as Array<{ id: string; decisions: CountBody }>;
    expect(before.find((p) => p.id === "fleet")!.decisions).toEqual({
      waiting: 1,
      oneWay: 0,
      reported: 0,
      closed: 0,
    });

    await postState(
      started,
      token,
      "fleet",
      "d1",
      {
        state: "approved",
        source: "reported",
        revision: 1,
        textSha256,
        expectedEntries: 0,
        by: "owner",
        at: "2026-10-08T13:00:00Z",
        words: "yes",
      },
      clk.pass,
    );

    const inbox = (await fetch(`${started.origin}/api/v1/inbox`).then((r) =>
      r.json(),
    )) as {
      projects: Array<{ id: string; counts: CountBody; decisions: Head[] }>;
    };
    const fleet = inbox.projects.find((p) => p.id === "fleet")!;
    expect(fleet.counts).toEqual({
      waiting: 0,
      oneWay: 0,
      reported: 1,
      closed: 0,
    });
    expect(fleet.decisions.find((d) => d.id === "d1")).toBeDefined();
  });
});

describe("rule 3: the head carries the door reason byte-for-byte", () => {
  it("echoes the stored reason, verbatim", async () => {
    const clk = clock();
    const started = await startHarness({
      adminToken: ADMIN_TOKEN,
      now: clk.now,
    });
    const tokens = await registerAll(started, clk.pass);
    const body = decision("fleet", "d1");
    const reason = "byte-for-byte <reason>";
    await putDecision(started, tokens.fleet!, "fleet", "d1", body, clk.pass);

    const view = (await fetch(
      `${started.origin}/api/v1/projects/fleet/decisions/d1`,
    ).then((r) => r.json())) as { head: Head };
    expect(view.head.door.value).toBe("partly");
    expect(view.head.door.reason).toBe(reason);
  });
});

describe("rule 4: a new revision with changed text returns to open", () => {
  it("and sets earlierAnswer to the answer on the old text", async () => {
    const clk = clock();
    const started = await startHarness({
      adminToken: ADMIN_TOKEN,
      now: clk.now,
    });
    const tokens = await registerAll(started, clk.pass);
    const token = tokens.fleet!;
    await putDecision(
      started,
      token,
      "fleet",
      "other",
      decision("fleet", "other"),
      clk.pass,
    );
    const first = decision("fleet", "d1");
    const { textSha256 } = await putDecision(
      started,
      token,
      "fleet",
      "d1",
      first,
      clk.pass,
    );

    await postState(
      started,
      token,
      "fleet",
      "d1",
      {
        state: "approved",
        source: "reported",
        revision: 1,
        textSha256,
        expectedEntries: 0,
        by: "owner",
        at: "2026-10-08T13:00:00Z",
        words: "yes",
      },
      clk.pass,
    );

    // A revision that changes binding text: same hash is NOT enough, the question
    // changes the text.
    const second = { ...decision("fleet", "d1"), question: "Other?" };
    await putDecision(started, token, "fleet", "d1", second, clk.pass);

    const view = (await fetch(
      `${started.origin}/api/v1/projects/fleet/decisions/d1`,
    ).then((r) => r.json())) as { head: Head };
    expect(view.head.state).toBe("open");
    expect(view.head.earlierAnswer).toBeDefined();
    expect(view.head.earlierAnswer!.state).toBe("approved");
  });
});

describe("coveredAnswer", () => {
  it("is set when a withdrawal covers a reported answer on the same text", async () => {
    const clk = clock();
    const started = await startHarness({
      adminToken: ADMIN_TOKEN,
      now: clk.now,
    });
    const tokens = await registerAll(started, clk.pass);
    const token = tokens.fleet!;
    const first = decision("fleet", "d1");
    const { textSha256 } = await putDecision(
      started,
      token,
      "fleet",
      "d1",
      first,
      clk.pass,
    );

    await postState(
      started,
      token,
      "fleet",
      "d1",
      {
        state: "approved",
        source: "reported",
        revision: 1,
        textSha256,
        expectedEntries: 0,
        by: "owner",
        at: "2026-10-08T13:00:00Z",
        words: "yes",
      },
      clk.pass,
    );

    await putDecision(
      started,
      token,
      "fleet",
      "other",
      decision("fleet", "other"),
      clk.pass,
    );

    await postState(
      started,
      token,
      "fleet",
      "d1",
      {
        state: "superseded",
        source: "session",
        revision: 1,
        textSha256,
        expectedEntries: 1,
        by: "owner",
        at: "2026-10-08T14:00:00Z",
        supersededBy: "other",
      },
      clk.pass,
    );

    const view = (await fetch(
      `${started.origin}/api/v1/projects/fleet/decisions/d1`,
    ).then((r) => r.json())) as { head: Head };
    expect(view.head.state).toBe("superseded");
    expect(view.head.coveredAnswer).toBeDefined();
    expect(view.head.coveredAnswer!.state).toBe("approved");
  });
});

describe("notice read routes", () => {
  it("serves a project's events newest first", async () => {
    const clk = clock();
    const started = await startHarness({
      adminToken: ADMIN_TOKEN,
      now: clk.now,
    });
    const tokens = await registerAll(started, clk.pass);
    await postEvent(started, tokens.fleet!, "fleet", "relay", clk.pass);
    await postEvent(started, tokens.fleet!, "fleet", "policy", clk.pass);

    const res = await fetch(`${started.origin}/api/v1/projects/fleet/events`);
    const body = (await res.json()) as {
      events: Array<{ event: { topic: string } }>;
    };
    expect(body.events.map((e) => e.event.topic)).toEqual(["policy", "relay"]);
  });

  it("serves a decision's head, revisions and entries", async () => {
    const clk = clock();
    const started = await startHarness({
      adminToken: ADMIN_TOKEN,
      now: clk.now,
    });
    const tokens = await registerAll(started, clk.pass);
    const body = decision("fleet", "d1");
    await putDecision(started, tokens.fleet!, "fleet", "d1", body, clk.pass);

    const res = await fetch(
      `${started.origin}/api/v1/projects/fleet/decisions/d1`,
    );
    const view = (await res.json()) as {
      head: Head;
      revisions: unknown[];
      entries: unknown[];
    };
    expect(view.head.revision).toBe(1);
    expect(view.head.state).toBe("open");
    expect(view.revisions).toHaveLength(1);
    expect(view.entries).toEqual([]);
  });

  it("404s an unknown decision", async () => {
    const clk = clock();
    const started = await startHarness({
      adminToken: ADMIN_TOKEN,
      now: clk.now,
    });
    await registerAll(started, clk.pass);
    expect(
      (await fetch(`${started.origin}/api/v1/projects/fleet/decisions/absent`))
        .status,
    ).toBe(404);
  });
});
