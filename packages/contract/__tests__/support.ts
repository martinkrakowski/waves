import { expect } from "vitest";

import {
  validateEnvelope,
  validateStatus,
  type Envelope,
  type ProjectStatus,
  type ValidationIssue,
  type ValidationResult,
} from "../src/index.js";

export const BELL = String.fromCharCode(0x07);

export const DEL = String.fromCharCode(0x7f);

export function minimalEnvelope(): Record<string, unknown> {
  return {
    schema: "waves/v1",
    project: "alpha",
    wave: "wv1",
    generatedAt: "2026-10-01T12:00:00Z",
    intervalSeconds: null,
    lanes: [],
  };
}

export function minimalLane(
  patch: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "lane-1",
    derived: { alive: true },
    disagreements: [],
    ...patch,
  };
}

export function oneLane(
  patch: Record<string, unknown> = {},
): Record<string, unknown> {
  return { ...minimalEnvelope(), lanes: [minimalLane(patch)] };
}

export function fullEnvelope(): Record<string, unknown> {
  return {
    schema: "waves/v1",
    project: "alpha",
    wave: "wv1",
    generatedAt: "2026-10-01T12:00:00.000Z",
    intervalSeconds: 10,
    lanes: [
      {
        id: "lane-1",
        seat: "operator one",
        reported: {
          stage: "review",
          event: "settled",
          ts: "2026-10-01T11:59:00Z",
          pr: 42,
          round: 0,
          detail: { note: "first line\nsecond line\tindented" },
        },
        derived: {
          alive: true,
          exit: 0,
          gate: {
            exit: 0,
            coverage: {
              statements: 100,
              branches: 96.5,
              functions: 100,
              lines: 99,
            },
          },
          pr: {
            number: 42,
            state: "open",
            checks: "pending",
            unresolvedThreads: "unknown",
          },
          diff: { files: 3, insertions: 10, deletions: 2 },
          log: {
            bytes: 2048,
            mtimeMs: 1767225600000,
            tail: "compiling\nlinking",
          },
          planReview: "approved by the owner",
          risk: "none known",
        },
        disagreements: ["derived exit 0 while checks are pending"],
      },
    ],
  };
}

export function errorsOf(
  result: ValidationResult<unknown>,
): readonly ValidationIssue[] {
  if (result.ok) {
    throw new Error("expected the value to be rejected");
  }
  return result.errors;
}

export function expectEnvelopePaths(
  input: unknown,
  expected: readonly string[],
): readonly ValidationIssue[] {
  const result = validateEnvelope(input);
  expect(errorsOf(result).map((error) => error.path)).toEqual(expected);
  return errorsOf(result);
}

export function expectValidEnvelope(input: unknown): Envelope {
  const result = validateEnvelope(input);
  if (!result.ok) {
    throw new Error(
      `expected a valid envelope, got ${JSON.stringify(result.errors)}`,
    );
  }
  return result.value;
}

/** The minimal document of the "The project status document" docs section. */
export function minimalStatus(): Record<string, unknown> {
  return {
    schema: "waves-status/v1",
    project: "apollo",
    generatedAt: "2026-10-03T08:00:00Z",
    intervalSeconds: null,
  };
}

export function withBacklog(
  patch: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...minimalStatus(),
    backlog: { state: "recorded", ...patch },
  };
}

export function withPremise(
  patch: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...withBacklog(),
    backlog: {
      state: "recorded",
      premises: [{ lane: "C1", plan: "plan-c", status: "holds", ...patch }],
    },
  };
}

/** The full document of the "The project status document" docs section. */
export function fullStatus(): Record<string, unknown> {
  return {
    schema: "waves-status/v1",
    project: "apollo",
    generatedAt: "2026-10-03T08:00:00.250Z",
    intervalSeconds: 300,
    prs: { skipped: 2 },
    backlog: {
      state: "recorded",
      at: "2026-10-03T07:55:00Z",
      scope: { kind: "full", plans: ["plan:verify"] },
      git: {
        branch: "main",
        head: "0a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
      },
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
  };
}

export function expectStatusPaths(
  input: unknown,
  expected: readonly string[],
): readonly ValidationIssue[] {
  const result = validateStatus(input);
  expect(errorsOf(result).map((error) => error.path)).toEqual(expected);
  return errorsOf(result);
}

export function expectValidStatus(input: unknown): ProjectStatus {
  const result = validateStatus(input);
  if (!result.ok) {
    throw new Error(
      `expected a valid status, got ${JSON.stringify(result.errors)}`,
    );
  }
  return result.value;
}
