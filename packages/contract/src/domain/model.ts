import type { LaneId, ProjectId, WaveId } from "./ids.js";

export const SCHEMA = "waves/v1";

export const STATUS_SCHEMA = "waves-status/v1";

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

export interface PrsStatus {
  skipped: number;
}

export type BacklogState = "recorded" | "absent" | "unknown";

export type PremiseStatus = "holds" | "stale" | "timed-out" | "error";

export interface BacklogScope {
  kind: "full" | "partial";
  plans: string[];
}

export interface BacklogGit {
  branch: string;
  head: string;
}

export interface Premise {
  lane: string;
  plan: string;
  status: PremiseStatus;
  reason?: string;
}

export interface Backlog {
  state: BacklogState;
  at?: string;
  scope?: BacklogScope;
  git?: BacklogGit;
  premises?: Premise[];
}

export interface ProjectStatus {
  schema: typeof STATUS_SCHEMA;
  project: ProjectId;
  generatedAt: string;
  intervalSeconds: number | null;
  prs?: PrsStatus;
  backlog?: Backlog;
}
