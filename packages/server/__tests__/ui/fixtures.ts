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
} from "../../src/application/notice-read-model.js";
import type { ProjectCard } from "../../public/api.js";

export const NOW_MS = Date.parse("2026-04-01T12:00:00.000Z");
export const NOW_ISO = new Date(NOW_MS).toISOString();

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
