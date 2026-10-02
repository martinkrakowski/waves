import type {
  EnvelopeView,
  LaneView,
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
