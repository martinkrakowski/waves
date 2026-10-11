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

export const NOTICE_SCHEMA = "waves-notice/v1";

export const MAX_OPTIONS = 8;
export const MAX_COMMITS = 8;
export const MAX_EVIDENCE = 8;
export const MAX_APPLIES_TO = 16;
export const MAX_QUESTION_CHARS = 300;
export const MAX_TEXT_CHARS = 2000;
export const MAX_LABEL_CHARS = 80;
export const MAX_RAISED_BY_CHARS = 80;
export const OPTION_KEY_PATTERN = /^[a-z0-9]{1,8}$/;

export const MAX_DECISIONS_PER_PROJECT = 500;
export const MAX_EVENTS_PER_PROJECT = 2000;
export const MAX_REVISIONS_PER_DECISION = 20;
export const MAX_SESSION_ENTRIES_PER_DECISION = 50;

export type NoticeRefs = { wave?: WaveId; lane?: LaneId; pr?: number };

export type DecisionShape = "choice" | "action" | "instruction";

export type Decider = "owner" | "delegated";

export type DoorValue = true | false | "partly";

export type DecisionState =
  | "open"
  | "delegated"
  | "approved"
  | "declined"
  | "answered"
  | "withdrawn"
  | "superseded";

export type StateSource = "session" | "reported" | "signed";

/** What the owner said when he signed: he approved the recommendation, declined,
 * or answered with another option or in his own words. */
export type AnswerVerdict = "approved" | "declined" | "answered";

export interface DecisionOption {
  readonly key: string;
  readonly text: string;
  readonly cost: string;
}

export interface NoticeEvidence {
  readonly label: string;
  readonly href: string;
}

export interface DecisionRevision {
  readonly schema: typeof NOTICE_SCHEMA;
  readonly kind: "decision";
  readonly project: ProjectId;
  readonly id: LaneId;
  readonly shape: DecisionShape;
  readonly question: string;
  readonly options: DecisionOption[];
  readonly recommended?: { readonly option: string; readonly reason: string };
  readonly hardToUndo: { readonly value: DoorValue; readonly reason?: string };
  readonly commits: string[];
  readonly decider: Decider;
  readonly appliesTo: ProjectId[];
  readonly evidence: NoticeEvidence[];
  readonly actElsewhere?: { readonly where: string; readonly what: string };
  readonly raisedBy: string;
  readonly raisedAt: string;
  readonly refs?: NoticeRefs;
  readonly changeNote?: string;
}

export interface StateEntryRequest {
  readonly state: DecisionState;
  readonly source: StateSource;
  readonly revision: number;
  readonly textSha256: string;
  readonly expectedEntries: number;
  readonly by: string;
  readonly at: string;
  readonly words?: string;
  readonly option?: string;
  readonly reason?: string;
  readonly supersededBy?: LaneId;
}

/** The body of a signed answer, as the page posts it. The server rebuilds the
 * challenge from it and checks the assertion; the contract only bounds it. */
export interface AnswerRequest {
  readonly revision: number;
  readonly textSha256: string;
  readonly index: number;
  readonly verdict: AnswerVerdict;
  readonly option?: string;
  readonly words?: string;
  readonly nonce: string;
  readonly credentialId: string;
  readonly authenticatorData: string;
  readonly clientDataJSON: string;
  readonly signature: string;
}

/** The assertion a signed answer keeps: the credential that signed, the three
 * opaque byte strings it signed over, and the nonce and position it bound. */
export interface AnswerSignature {
  readonly credentialId: string;
  readonly authenticatorData: string;
  readonly clientDataJSON: string;
  readonly signature: string;
  readonly nonce: string;
  readonly index: number;
}

/** One state entry as the store holds it: the writer's entry minus the
 * `expectedEntries` it pinned on. A `signed` entry carries the assertion that
 * bound it; no other source's entry carries one. */
export interface StoredStateEntry {
  readonly state: DecisionState;
  readonly source: StateSource;
  readonly revision: number;
  readonly textSha256: string;
  readonly by: string;
  readonly at: string;
  readonly words?: string;
  readonly option?: string;
  readonly reason?: string;
  readonly supersededBy?: LaneId;
  readonly signature?: AnswerSignature;
}

/** One credential the owner's answers may come from: the public half only. The
 * private key stays on the device that made it and never reaches the server. */
export interface OwnerKey {
  readonly credentialId: string;
  readonly publicKeySpki: string;
  readonly label: string;
  readonly addedAt: string;
  readonly retired?: boolean;
}

/** The owner-keys document: the credentials the page accepts an assertion from,
 * and nothing else. No route registers, replaces or removes one (W62). */
export interface OwnerKeys {
  readonly schema: "waves-owner-keys/v1";
  readonly keys: OwnerKey[];
}

export interface NoticeEvent {
  readonly schema: typeof NOTICE_SCHEMA;
  readonly kind: "event";
  readonly project: ProjectId;
  readonly topic: string;
  readonly text: string;
  readonly detail?: string;
  readonly at: string;
  readonly refs?: NoticeRefs;
}
