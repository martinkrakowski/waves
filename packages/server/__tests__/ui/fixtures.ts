import type {
  AttentionLane,
  AttentionView,
  EnvelopeView,
  LaneRow,
  LaneView,
  ProjectLanesView,
  RecentWave,
  StatusView,
  WaveSummary,
  WaveView,
} from "../../src/application/read-model.js";
import type {
  Head,
  InboxProject,
  InboxView,
  NoticeCounts,
  DecisionView,
} from "../../src/application/notice-read-model.js";
import type {
  StoredRevision,
  StoredEntry,
} from "../../src/application/ports/notice-store.js";
import type { ProjectCard } from "../../public/api.js";
import type { DecisionRevision } from "../../../contract/src/domain/model.js";

export const NOW_MS = Date.parse("2026-04-01T12:00:00.000Z");
export const NOW_ISO = new Date(NOW_MS).toISOString();

/** The placeholder text hash every fixture carries, as the server would. */
export const HASH = "0".repeat(64);

/**
 * The two facts a project summary carries about its own status. `prsSkipped` is
 * present here because the fixture document carries a `prs`; a test that wants the
 * silence says so by not giving it.
 */
export function statusFacts(
  overrides: Partial<NonNullable<ProjectCard["status"]>> = {},
): NonNullable<ProjectCard["status"]> {
  return {
    receivedAt: NOW_ISO,
    stale: false,
    prsSkipped: 2,
    backlogState: "recorded",
    ...overrides,
  };
}

export function projectCard(overrides: Partial<ProjectCard> = {}): ProjectCard {
  return {
    id: "alpha",
    name: "Alpha",
    repo: "https://git.example.test/alpha",
    registeredAt: "2026-04-01T08:00:00.000Z",
    waves: 3,
    lanes: 6,
    lastPush: "2026-04-01T11:58:00.000Z",
    stale: false,
    recentWaves: [],
    decisions: { waiting: 0, oneWay: 0, reported: 0, closed: 0 },
    ...overrides,
  };
}

/**
 * One entry of a project's `recentWaves`. `state` and `stale` are the two facts
 * the fleet page reads a wave's row by, and `merged` is a count of lanes, so the
 * default carries one of each rather than only the required keys.
 */
export function recentWave(overrides: Partial<RecentWave> = {}): RecentWave {
  return {
    wave: "w-3",
    receivedAt: NOW_ISO,
    lanes: 2,
    state: "running",
    stale: false,
    merged: 1,
    ...overrides,
  };
}

export function waveSummary(overrides: Partial<WaveSummary> = {}): WaveSummary {
  return {
    wave: "w-3",
    receivedAt: NOW_ISO,
    intervalSeconds: 30,
    lanes: 2,
    stale: false,
    retained: true,
    ...overrides,
  };
}

/**
 * One row of the project listing: a lane with only what the row type requires,
 * so a test that wants a lane carrying nothing optional says so by not giving it
 * anything. The wave is `w-3`, the one `waveSummary()` carries, so the default
 * row belongs to a wave the default listing holds.
 */
export function laneRow(overrides: Partial<LaneRow> = {}): LaneRow {
  return {
    wave: "w-3",
    id: "wv-a",
    derived: { alive: true },
    disagreements: 0,
    reasons: [],
    ...overrides,
  };
}

/** What `/api/v1/projects/alpha/lanes` answers, before anything is wrong. */
export function projectLanes(
  overrides: Partial<ProjectLanesView> = {},
): ProjectLanesView {
  return {
    project: { id: "alpha", name: "Alpha" },
    waves: [waveSummary()],
    wavesOmitted: 0,
    lanes: [laneRow()],
    truncated: false,
    ...overrides,
  };
}

export function lane(overrides: Partial<LaneView> = {}): LaneView {
  return {
    id: "wv-a",
    seat: "s1",
    reported: {
      stage: "review",
      event: "settled",
      ts: NOW_ISO,
      pr: 42,
      round: 2,
      detail: { verdict: "ship it", risk: "low" },
    },
    derived: {
      alive: true,
      exit: 0,
      gate: {
        exit: 0,
        coverage: {
          statements: 98,
          branches: 91.5,
          functions: 100,
          lines: 99,
        },
      },
      pr: { number: 42, state: "open", checks: "pass", unresolvedThreads: 1 },
      diff: { files: 3, insertions: 120, deletions: 14 },
      log: { bytes: 4096, mtimeMs: NOW_MS, tail: "gate ok\ntests ok" },
      planReview: "two approvals",
      risk: "low",
    },
    disagreements: ["seat 1 says pass, the gate says fail"],
    ...overrides,
  };
}

export function envelope(overrides: Partial<EnvelopeView> = {}): EnvelopeView {
  return {
    schema: "waves/v1",
    project: "alpha",
    wave: "w-3",
    generatedAt: NOW_ISO,
    intervalSeconds: 30,
    lanes: [lane(), lane({ id: "wv-b", seat: undefined })],
    ...overrides,
  };
}

export function waveView(overrides: Partial<WaveView> = {}): WaveView {
  return {
    envelope: envelope(),
    receivedAt: NOW_ISO,
    stale: false,
    staleAfterMs: 90_000,
    ...overrides,
  };
}

/**
 * One lane the attention route is asking about. The three ids are deliberately
 * different from each other, so a view that swapped two of them builds a link
 * that is wrong rather than one that happens to be right.
 */
export function attentionLane(
  overrides: Partial<AttentionLane> = {},
): AttentionLane {
  return {
    project: "alpha",
    wave: "w-3",
    lane: "wv-a",
    reasons: ["failed"],
    receivedAt: NOW_ISO,
    stale: false,
    ...overrides,
  };
}

/** What `/api/v1/projects/alpha/status` answers, before anything is wrong. */
export function statusView(overrides: Partial<StatusView> = {}): StatusView {
  return {
    status: {
      schema: "waves-status/v1",
      project: "alpha",
      generatedAt: NOW_ISO,
      intervalSeconds: 30,
      prs: { skipped: 2 },
      backlog: {
        state: "recorded",
        at: "2026-04-01T11:40:00.000Z",
        scope: { kind: "full", plans: ["plan:verify"] },
        git: { branch: "main", head: "0a1b2c3d4e5f60718293a4b5c6d7e8f9" },
        premises: [
          { lane: "C1", plan: "plan:verify", status: "holds" },
          {
            lane: "C2",
            plan: "plan:verify",
            status: "timed-out",
            reason: "no push since 06:00",
          },
        ],
      },
    },
    receivedAt: NOW_ISO,
    stale: false,
    staleAfterMs: 90_000,
    ...overrides,
  };
}

/**
 * The whole fleet asking for attention, before anything is asking.
 */
export function attentionView(
  overrides: Partial<AttentionView> = {},
): AttentionView {
  return {
    lanes: [],
    projects: [],
    truncated: false,
    wavesOmitted: 0,
    ...overrides,
  };
}

export const INBOX_NOW_MS = Date.parse("2026-10-08T14:00:00.000Z");

/** One entry of the `counts` object the inbox answers with. */
export function inboxCounts(
  overrides: Partial<NoticeCounts> = {},
): NoticeCounts {
  return { waiting: 0, oneWay: 0, reported: 0, closed: 0, ...overrides };
}

/** One decision head, as `GET /api/v1/inbox` answers it. */
export function inboxHead(overrides: Partial<Head> = {}): Head {
  return {
    project: "alpha",
    id: "d1",
    question: "Go?",
    shape: "choice",
    door: { value: false },
    decider: "owner",
    revision: 1,
    revisions: 1,
    textSha256: "0".repeat(64),
    entries: 0,
    state: "open",
    at: NOW_ISO,
    group: "waiting",
    ...overrides,
  };
}

/** One project in the inbox list, with its counts and its decisions. */
export function inboxProject(
  overrides: Partial<InboxProject> = {},
): InboxProject {
  return {
    id: "alpha",
    name: "Alpha",
    counts: inboxCounts(),
    decisions: [],
    ...overrides,
  };
}

/** The whole inbox, empty until a test fills it. */
export function inboxView(overrides: Partial<InboxView> = {}): InboxView {
  return {
    projects: [],
    ...overrides,
  };
}

/**
 * One decision revision, as `decisionBindingText` would see it. The `project`
 * and `id` match the head a test puts the revision under.
 */
export function decisionRevision(
  overrides: Partial<DecisionRevision> = {},
): DecisionRevision {
  return {
    schema: "waves-notice/v1",
    kind: "decision",
    project: "alpha",
    id: "d1",
    shape: "choice",
    question: "Go?",
    options: [
      { key: "a", text: "Yes", cost: "C1" },
      { key: "b", text: "No", cost: "C2" },
    ],
    hardToUndo: { value: false },
    commits: [],
    decider: "owner",
    appliesTo: [],
    evidence: [],
    raisedBy: "session",
    raisedAt: "2026-10-08T12:00:00Z",
    ...overrides,
  } as DecisionRevision;
}

/** One revision as the store holds it, wrapping a decision revision. */
export function storedRevision(
  overrides: Partial<StoredRevision> = {},
): StoredRevision {
  return {
    revision: 1,
    textSha256: HASH,
    receivedAt: NOW_ISO,
    decision: decisionRevision(),
    ...overrides,
  } as StoredRevision;
}

/** One state entry as the store holds it. */
export function decisionEntry(
  overrides: Partial<StoredEntry> = {},
): StoredEntry {
  return {
    index: 0,
    receivedAt: NOW_ISO,
    state: "approved",
    source: "reported",
    revision: 1,
    textSha256: HASH,
    by: "owner",
    at: "2026-10-08T13:00:00Z",
    words: "yes",
    ...overrides,
  } as StoredEntry;
}

/**
 * The whole response `GET /api/v1/projects/<project>/decisions/<id>` gives, built
 * from the helpers above so every baseline is consistent: the head's revision,
 * revision count, hash and entry count all agree with the arrays.
 */
export function decisionResponse(
  overrides: Partial<DecisionView> = {},
): DecisionView {
  return {
    head: inboxHead(),
    revisions: [storedRevision()],
    entries: [],
    ...overrides,
  } as DecisionView;
}

import { NOTICE_DECISIONS } from "../../../contract/__tests__/fixtures/notice-decisions.js";
import type { NoticeFixture } from "../../../contract/__tests__/fixtures/notice-decisions.js";

/** The names the registry uses for the fourteen fixtures' projects. */
const INBOX_NAMES: Record<string, string> = {
  "hexagen-monaco": "Hexagen Monaco",
  "campaign-foundry": "Campaign Foundry",
  "gate-lock": "Gate Lock",
  fleet: "Fleet",
  "client-portal": "Client Portal",
  waves: "Waves",
};

/**
 * Twelve days — the window the server uses to decide if a reported answer or a
 * session-closed decision stays in the inbox. All fixture dates are within it at
 * `INBOX_NOW_MS`, which is what this helper depends on.
 */
const INBOX_REPORTED_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * The group a head falls in at `nowMs`, by the rules in docs/waves-v1.md 5.1.2:
 * `open` and `delegated` are waiting; an answer within the window is reported; a
 * withdrawal or supersession within the window is closed; and everything older
 * is history — which the server leaves out of the inbox entirely.
 */
function inboxGroup(
  state: string,
  at: string,
  nowMs: number,
): "waiting" | "reported" | "closed" | "history" {
  if (state === "open" || state === "delegated") {
    return "waiting";
  }
  const withinWindow = nowMs - Date.parse(at) <= INBOX_REPORTED_WINDOW_MS;
  if (state === "approved" || state === "declined" || state === "answered") {
    return withinWindow ? "reported" : "history";
  }
  return withinWindow ? "closed" : "history";
}

/**
 * The current entry on a fixture's current revision, if it has one. A fixture's
 * states each carry a `revision`; the one matching the latest revision number is
 * current, and the last of those is the entry the server calls "current".
 */
function currentEntry(
  fixture: NoticeFixture,
): Record<string, unknown> | undefined {
  const latestRevision = fixture.revisions.length;
  const matching = fixture.states.filter((s) => {
    const rev = (s as { revision?: number }).revision;
    if (rev === latestRevision) {
      return true;
    }
    return latestRevision === 1 && (rev === undefined || rev === 1);
  });
  return matching[matching.length - 1];
}

/**
 * One head built from a fixture, by the rules in 5.1.2. This is NOT the server's
 * own model — it hardcodes the hash, assumes every date is in-window, and only
 * computes the fields the inbox view reads. The server's
 * `http-notice-read.test.ts` is what checks that the real response is right;
 * this helper only feeds a plausible one to the page.
 */
export function headFromFixture(fixture: NoticeFixture, nowMs: number): Head {
  const latest = fixture.revisions[fixture.revisions.length - 1] as Record<
    string,
    unknown
  >;
  const revision = fixture.revisions.length;
  const hardToUndo = latest.hardToUndo as
    { value: true | false | "partly"; reason?: string } | undefined;
  const entry = currentEntry(fixture);
  const state = entry ? (String(entry.state) as Head["state"]) : "open";
  const source = entry
    ? (entry.source as "session" | "reported" | undefined)
    : undefined;
  const at = entry
    ? String(entry.at)
    : String((latest as { raisedAt?: string }).raisedAt ?? NOW_ISO);
  const group = inboxGroup(state, at, nowMs) as Head["group"];
  return {
    project: fixture.project,
    id: fixture.id,
    question: String(latest.question ?? "Question?"),
    shape: String(
      (latest as { shape?: string }).shape ?? "choice",
    ) as Head["shape"],
    door: hardToUndo
      ? {
          value: hardToUndo.value,
          ...(hardToUndo.reason ? { reason: hardToUndo.reason } : {}),
        }
      : { value: false },
    decider: String(
      (latest as { decider?: string }).decider ?? "owner",
    ) as Head["decider"],
    revision,
    revisions: fixture.revisions.length,
    textSha256: "0".repeat(64),
    entries: fixture.states.length,
    state,
    ...(source ? { source } : {}),
    at,
    group,
    ...(latest.actElsewhere
      ? {
          actElsewhere: latest.actElsewhere as {
            where: string;
            what: string;
          },
        }
      : {}),
    from: undefined,
  };
}

/**
 * The inbox response the fourteen NOTICE_DECISIONS fixtures would produce, built
 * by the rules in docs/waves-v1.md 5.1.2. Each project's inbox holds its OWN
 * decisions only: an instruction raised by one project and applied to others
 * appears on those projects' /decisions listing (with `from`), but not on the
 * inbox — the inbox is the owner's own queue, not another project's card.
 * Decisions are sorted as the server sorts them: group, then one-way door,
 * then receive time. This is a test-only reconstruction, not the server's own
 * model: it hardcodes the hash, assumes every fixture date is in-window, and
 * only computes the fields the view reads.
 */
export function inboxFromFixtures(): InboxView {
  const nowMs = INBOX_NOW_MS;
  const registry: string[] = [];
  const ownHeads = new Map<string, Head[]>();

  for (const fixture of NOTICE_DECISIONS) {
    if (!ownHeads.has(fixture.project)) {
      ownHeads.set(fixture.project, []);
      registry.push(fixture.project);
    }
    ownHeads.get(fixture.project)!.push(headFromFixture(fixture, nowMs));
  }

  const projects: InboxProject[] = registry.map((id) => {
    const own = ownHeads.get(id) ?? [];
    const sorted = own.sort((a, b) => {
      const ga = a.group === "waiting" ? 0 : a.group === "reported" ? 1 : 2;
      const gb = b.group === "waiting" ? 0 : b.group === "reported" ? 1 : 2;
      if (ga !== gb) return ga - gb;
      const da = a.door.value === true ? 0 : 1;
      const db = b.door.value === true ? 0 : 1;
      if (da !== db) return da - db;
      return Date.parse(b.at) - Date.parse(a.at);
    });

    return inboxProject({
      id,
      name: INBOX_NAMES[id] ?? id,
      counts: noticeCountsOf(own),
      decisions: sorted,
    });
  });

  return inboxView({ projects });
}

/** The four counts of a project's own decisions, as the server computes them. */
function noticeCountsOf(heads: readonly Head[]): NoticeCounts {
  const counts = { waiting: 0, oneWay: 0, reported: 0, closed: 0 };
  for (const head of heads) {
    if (head.from !== undefined) {
      continue;
    }
    if (head.group === "waiting") {
      counts.waiting += 1;
      if (head.door.value === true) {
        counts.oneWay += 1;
      }
    } else if (head.group === "reported") {
      counts.reported += 1;
    } else if (head.group === "closed") {
      counts.closed += 1;
    }
  }
  return counts;
}
