/**
 * The application's own declaration of the records the store holds. The
 * application layer may not import the contract package, because every bare
 * import specifier is a lint error under `src/application/`, so the shapes it
 * reads are declared here instead. `infrastructure/http-server.ts` is the only
 * place that joins the two, and the compiler fails there when the contract
 * stops satisfying these declarations.
 */

export interface GateCoverageRecord {
  readonly statements: number;
  readonly branches: number;
  readonly functions: number;
  readonly lines: number;
}

export interface GateRecord {
  readonly exit?: number;
  readonly coverage?: GateCoverageRecord;
}

export interface PullRequestRecord {
  readonly number: number;
  readonly state: string;
  readonly checks: string;
  readonly unresolvedThreads?: number | "unknown";
}

export interface DiffStatRecord {
  readonly files: number;
  readonly insertions: number;
  readonly deletions: number;
}

export interface LaneLogRecord {
  readonly bytes: number;
  readonly mtimeMs: number;
  readonly tail?: string;
}

export interface LaneDerivedRecord {
  readonly alive: boolean;
  readonly exit?: number;
  readonly gate?: GateRecord;
  readonly pr?: PullRequestRecord;
  readonly diff?: DiffStatRecord;
  readonly log?: LaneLogRecord;
  readonly planReview?: string;
  readonly risk?: string;
}

export interface LaneReportedRecord {
  readonly stage: string;
  readonly event: string;
  readonly ts: string;
  readonly pr?: number;
  readonly round?: number;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface LaneRecord {
  readonly id: string;
  readonly seat?: string;
  readonly reported?: LaneReportedRecord;
  readonly derived: LaneDerivedRecord;
  readonly disagreements: readonly string[];
}

export interface EnvelopeRecord {
  readonly schema: string;
  readonly project: string;
  readonly wave: string;
  readonly generatedAt: string;
  readonly intervalSeconds: number | null;
  readonly lanes: readonly LaneRecord[];
}

export interface ProjectRecord {
  readonly id: string;
  readonly name: string;
  readonly repo?: string;
  readonly tokenSha256: string;
  readonly registeredAt: string;
}

export interface StoredSnapshotRecord {
  readonly envelope: EnvelopeRecord;
  readonly receivedAt: string;
}
