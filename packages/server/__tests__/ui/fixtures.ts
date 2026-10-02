import type {
  AttentionLane,
  AttentionView,
  EnvelopeView,
  LaneRow,
  LaneView,
  ProjectLanesView,
  WaveSummary,
  WaveView,
} from "../../src/application/read-model.js";
import type { ProjectCard } from "../../public/api.js";

export const NOW_MS = Date.parse("2026-04-01T12:00:00.000Z");
export const NOW_ISO = new Date(NOW_MS).toISOString();

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

/** The whole fleet asking for attention, before anything is asking. */
export function attentionView(
  overrides: Partial<AttentionView> = {},
): AttentionView {
  return {
    lanes: [],
    projects: [],
    truncated: false,
    ...overrides,
  };
}
