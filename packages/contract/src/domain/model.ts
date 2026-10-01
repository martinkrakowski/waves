import type { LaneId, ProjectId, WaveId } from "./ids.js";

export const SCHEMA = "waves/v1";

export type LaneEvent = "started" | "settled" | "failed";

export type PullRequestState = "open" | "merged" | "closed";

export type CheckStatus = "none" | "pending" | "pass" | "fail" | "unknown";

export interface GateCoverage {
  statements: number;
  branches: number;
  functions: number;
  lines: number;
}

export interface Gate {
  exit?: number;
  coverage?: GateCoverage;
}

export interface PullRequest {
  number: number;
  state: PullRequestState;
  checks: CheckStatus;
  unresolvedThreads?: number | "unknown";
}

export interface DiffStat {
  files: number;
  insertions: number;
  deletions: number;
}

export interface LaneLog {
  bytes: number;
  mtimeMs: number;
  tail?: string;
}

export interface LaneDerived {
  alive: boolean;
  exit?: number;
  gate?: Gate;
  pr?: PullRequest;
  diff?: DiffStat;
  log?: LaneLog;
  planReview?: string;
  risk?: string;
}

export interface LaneReported {
  stage: string;
  event: LaneEvent;
  ts: string;
  pr?: number;
  round?: number;
  detail?: Record<string, unknown>;
}

export interface Lane {
  id: LaneId;
  seat?: string;
  reported?: LaneReported;
  derived: LaneDerived;
  disagreements: string[];
}

export interface Envelope {
  schema: typeof SCHEMA;
  project: ProjectId;
  wave: WaveId;
  generatedAt: string;
  intervalSeconds: number | null;
  lanes: Lane[];
}

export interface Project {
  id: ProjectId;
  name: string;
  repo?: string;
  tokenSha256: string;
  registeredAt: string;
}

export interface StoredSnapshot {
  envelope: Envelope;
  receivedAt: string;
}
