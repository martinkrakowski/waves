import { readIntervalSeconds, readProjectId } from "./fields.js";
import { isLaneId, isWaveId } from "./ids.js";
import { SCHEMA } from "./model.js";
import type {
  CheckStatus,
  DiffStat,
  Envelope,
  Gate,
  GateCoverage,
  Lane,
  LaneDerived,
  LaneLog,
  LaneReported,
  PullRequest,
  PullRequestState,
} from "./model.js";
import {
  type Collector,
  type StringRule,
  type ValidationResult,
  IssueCollector,
  byteLength,
  hasForbiddenCharacters,
  isRecord,
  normalise,
  own,
  readBoolean,
  readClosedObject,
  readEnum,
  readInteger,
  readIntegerAtLeast,
  readNumberAtLeast,
  readNumberInRange,
  readOptional,
  readText,
  readTimestamp,
} from "./validation.js";

const LANE_EVENTS = ["started", "settled", "failed"] as const;
const PULL_REQUEST_STATES = ["open", "merged", "closed"] as const;
const CHECK_STATUSES = ["none", "pending", "pass", "fail", "unknown"] as const;

const ENVELOPE_KEYS = [
  "schema",
  "project",
  "wave",
  "generatedAt",
  "intervalSeconds",
  "lanes",
];
const LANE_KEYS = ["id", "seat", "reported", "derived", "disagreements"];
const REPORTED_KEYS = ["stage", "event", "ts", "pr", "round", "detail"];
const DERIVED_KEYS = [
  "alive",
  "exit",
  "gate",
  "pr",
  "diff",
  "log",
  "planReview",
  "risk",
];
const GATE_KEYS = ["exit", "coverage"];
const COVERAGE_KEYS = ["statements", "branches", "functions", "lines"];
const PULL_REQUEST_KEYS = ["number", "state", "checks", "unresolvedThreads"];
const DIFF_KEYS = ["files", "insertions", "deletions"];
const LOG_KEYS = ["bytes", "mtimeMs", "tail"];

const MAX_LANES = 200;
const MAX_SEAT_CHARS = 128;
const MAX_DETAIL_BYTES = 8192;
const MAX_TAIL_BYTES = 4096;
const MAX_REVIEW_CHARS = 200;
const MAX_DISAGREEMENTS = 20;
const MAX_DISAGREEMENT_CHARS = 300;
const MAX_DETAIL_DEPTH = 8;
const MAX_DETAIL_KEYS = 256;

const FORBIDDEN_DETAIL_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

const SEAT_RULE: StringRule = { minChars: 1, maxChars: MAX_SEAT_CHARS };
const STAGE_RULE: StringRule = {
  maxChars: 32,
  pattern: /^[a-z][a-z-]{0,31}$/,
};
const TAIL_RULE: StringRule = {
  maxBytes: MAX_TAIL_BYTES,
  lineBreaks: true,
};
const REVIEW_RULE: StringRule = { maxChars: MAX_REVIEW_CHARS };
const DISAGREEMENT_RULE: StringRule = { maxChars: MAX_DISAGREEMENT_CHARS };

function readWaveId(ctx: Collector, value: unknown, path: string): string {
  if (typeof value !== "string") {
    ctx.add(path, "expected a wave id");
    return "";
  }
  if (!isWaveId(value)) {
    ctx.add(path, "expected 1 to 80 characters of A-Z, a-z, 0-9, _ and -");
    return "";
  }
  return value;
}

function readLaneId(ctx: Collector, value: unknown, path: string): string {
  if (typeof value !== "string") {
    ctx.add(path, "expected a lane id");
    return "";
  }
  if (!isLaneId(value)) {
    ctx.add(path, "expected 1 to 80 characters of A-Z, a-z, 0-9, _ and -");
    return "";
  }
  return value;
}

interface DetailBudget {
  keys: number;
}

function detailProblem(
  value: unknown,
  depth: number,
  budget: DetailBudget,
): string | undefined {
  if (typeof value === "string") {
    return hasForbiddenCharacters(value, true)
      ? "expected printable text"
      : undefined;
  }
  if (Array.isArray(value)) {
    return detailSequenceProblem(value, depth, budget);
  }
  if (!isRecord(value)) {
    return undefined;
  }
  if (depth > MAX_DETAIL_DEPTH) {
    return `nested deeper than ${MAX_DETAIL_DEPTH} levels`;
  }
  for (const [key, item] of Object.entries(value)) {
    budget.keys += 1;
    if (budget.keys > MAX_DETAIL_KEYS) {
      return `more than ${MAX_DETAIL_KEYS} keys`;
    }
    if (FORBIDDEN_DETAIL_KEYS.has(key)) {
      return `the key ${key} is not allowed`;
    }
    if (hasForbiddenCharacters(key, false)) {
      return "a key contains a control character";
    }
    const problem = detailProblem(item, depth + 1, budget);
    if (problem !== undefined) {
      return problem;
    }
  }
  return undefined;
}

function detailSequenceProblem(
  items: readonly unknown[],
  depth: number,
  budget: DetailBudget,
): string | undefined {
  if (depth > MAX_DETAIL_DEPTH) {
    return `nested deeper than ${MAX_DETAIL_DEPTH} levels`;
  }
  for (const item of items) {
    const problem = detailProblem(item, depth + 1, budget);
    if (problem !== undefined) {
      return problem;
    }
  }
  return undefined;
}

function readDetail(
  ctx: Collector,
  value: unknown,
  path: string,
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    ctx.add(path, "expected an object");
    return undefined;
  }
  if (byteLength(JSON.stringify(value)) > MAX_DETAIL_BYTES) {
    ctx.add(path, `expected at most ${MAX_DETAIL_BYTES} serialized bytes`);
    return undefined;
  }
  const problem = detailProblem(value, 1, { keys: 0 });
  if (problem !== undefined) {
    ctx.add(path, problem);
    return undefined;
  }
  return value;
}

function readCoverage(
  ctx: Collector,
  value: unknown,
  path: string,
): GateCoverage | undefined {
  const record = readClosedObject(ctx, value, path, COVERAGE_KEYS);
  if (record === undefined) {
    return undefined;
  }
  return {
    statements:
      readNumberInRange(
        ctx,
        own(record, "statements"),
        `${path}/statements`,
        0,
        100,
      ) ?? 0,
    branches:
      readNumberInRange(
        ctx,
        own(record, "branches"),
        `${path}/branches`,
        0,
        100,
      ) ?? 0,
    functions:
      readNumberInRange(
        ctx,
        own(record, "functions"),
        `${path}/functions`,
        0,
        100,
      ) ?? 0,
    lines:
      readNumberInRange(ctx, own(record, "lines"), `${path}/lines`, 0, 100) ??
      0,
  };
}

function readGate(
  ctx: Collector,
  value: unknown,
  path: string,
): Gate | undefined {
  const record = readClosedObject(ctx, value, path, GATE_KEYS);
  if (record === undefined) {
    return undefined;
  }
  return {
    exit: readOptional(ctx, own(record, "exit"), `${path}/exit`, readInteger),
    coverage: readOptional(
      ctx,
      own(record, "coverage"),
      `${path}/coverage`,
      readCoverage,
    ),
  };
}

function readUnresolvedThreads(
  ctx: Collector,
  value: unknown,
  path: string,
): number | "unknown" | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "unknown") {
    return "unknown";
  }
  return readIntegerAtLeast(ctx, value, path, 0);
}

function readPullRequest(
  ctx: Collector,
  value: unknown,
  path: string,
): PullRequest | undefined {
  const record = readClosedObject(ctx, value, path, PULL_REQUEST_KEYS);
  if (record === undefined) {
    return undefined;
  }
  return {
    number:
      readIntegerAtLeast(ctx, own(record, "number"), `${path}/number`, 1) ?? 0,
    state:
      readEnum<PullRequestState>(
        ctx,
        own(record, "state"),
        `${path}/state`,
        PULL_REQUEST_STATES,
      ) ?? "open",
    checks:
      readEnum<CheckStatus>(
        ctx,
        own(record, "checks"),
        `${path}/checks`,
        CHECK_STATUSES,
      ) ?? "unknown",
    unresolvedThreads: readUnresolvedThreads(
      ctx,
      own(record, "unresolvedThreads"),
      `${path}/unresolvedThreads`,
    ),
  };
}

function readDiff(
  ctx: Collector,
  value: unknown,
  path: string,
): DiffStat | undefined {
  const record = readClosedObject(ctx, value, path, DIFF_KEYS);
  if (record === undefined) {
    return undefined;
  }
  return {
    files:
      readIntegerAtLeast(ctx, own(record, "files"), `${path}/files`, 0) ?? 0,
    insertions:
      readIntegerAtLeast(
        ctx,
        own(record, "insertions"),
        `${path}/insertions`,
        0,
      ) ?? 0,
    deletions:
      readIntegerAtLeast(
        ctx,
        own(record, "deletions"),
        `${path}/deletions`,
        0,
      ) ?? 0,
  };
}

function readLog(
  ctx: Collector,
  value: unknown,
  path: string,
): LaneLog | undefined {
  const record = readClosedObject(ctx, value, path, LOG_KEYS);
  if (record === undefined) {
    return undefined;
  }
  return {
    bytes:
      readIntegerAtLeast(ctx, own(record, "bytes"), `${path}/bytes`, 0) ?? 0,
    mtimeMs:
      readNumberAtLeast(ctx, own(record, "mtimeMs"), `${path}/mtimeMs`, 0) ?? 0,
    tail: readOptionalText(ctx, record, "tail", TAIL_RULE, path),
  };
}

function readOptionalText(
  ctx: Collector,
  record: Record<string, unknown>,
  key: string,
  rule: StringRule,
  base: string,
): string | undefined {
  const value = own(record, key);
  if (value === undefined) {
    return undefined;
  }
  return readText(ctx, value, `${base}/${key}`, rule);
}

function readDerived(
  ctx: Collector,
  value: unknown,
  path: string,
): LaneDerived | undefined {
  const record = readClosedObject(ctx, value, path, DERIVED_KEYS);
  if (record === undefined) {
    return undefined;
  }
  return {
    alive: readBoolean(ctx, own(record, "alive"), `${path}/alive`),
    exit: readOptional(ctx, own(record, "exit"), `${path}/exit`, readInteger),
    gate: readOptional(ctx, own(record, "gate"), `${path}/gate`, readGate),
    pr: readOptional(ctx, own(record, "pr"), `${path}/pr`, readPullRequest),
    diff: readOptional(ctx, own(record, "diff"), `${path}/diff`, readDiff),
    log: readOptional(ctx, own(record, "log"), `${path}/log`, readLog),
    planReview: readOptionalText(ctx, record, "planReview", REVIEW_RULE, path),
    risk: readOptionalText(ctx, record, "risk", REVIEW_RULE, path),
  };
}

function readReportedPr(
  ctx: Collector,
  value: unknown,
  path: string,
): number | undefined {
  return readIntegerAtLeast(ctx, value, path, 1);
}

function readReportedRound(
  ctx: Collector,
  value: unknown,
  path: string,
): number | undefined {
  return readIntegerAtLeast(ctx, value, path, 0);
}

function readReported(
  ctx: Collector,
  value: unknown,
  path: string,
): LaneReported | undefined {
  const record = readClosedObject(ctx, value, path, REPORTED_KEYS);
  if (record === undefined) {
    return undefined;
  }
  return {
    stage:
      readText(ctx, own(record, "stage"), `${path}/stage`, STAGE_RULE) ?? "",
    event:
      readEnum(ctx, own(record, "event"), `${path}/event`, LANE_EVENTS) ??
      "started",
    ts: readTimestamp(ctx, own(record, "ts"), `${path}/ts`) ?? "",
    pr: readOptional(ctx, own(record, "pr"), `${path}/pr`, readReportedPr),
    round: readOptional(
      ctx,
      own(record, "round"),
      `${path}/round`,
      readReportedRound,
    ),
    detail: readOptional(
      ctx,
      own(record, "detail"),
      `${path}/detail`,
      readDetail,
    ),
  };
}

function readDisagreements(
  ctx: Collector,
  value: unknown,
  path: string,
): string[] {
  if (!Array.isArray(value)) {
    ctx.add(path, "expected an array");
    return [];
  }
  if (value.length > MAX_DISAGREEMENTS) {
    ctx.add(path, `expected at most ${MAX_DISAGREEMENTS} entries`);
    return [];
  }
  const entries: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = readText(
      ctx,
      value[index],
      `${path}/${index}`,
      DISAGREEMENT_RULE,
    );
    if (entry !== undefined) {
      entries.push(entry);
    }
  }
  return entries;
}

function readLane(
  ctx: Collector,
  value: unknown,
  path: string,
): Lane | undefined {
  const record = readClosedObject(ctx, value, path, LANE_KEYS);
  if (record === undefined) {
    return undefined;
  }
  const id = readLaneId(ctx, own(record, "id"), `${path}/id`);
  const seat = readOptionalText(ctx, record, "seat", SEAT_RULE, path);
  const reported = readOptional(
    ctx,
    own(record, "reported"),
    `${path}/reported`,
    readReported,
  );
  const derived = readDerived(ctx, own(record, "derived"), `${path}/derived`);
  const disagreements = readDisagreements(
    ctx,
    own(record, "disagreements"),
    `${path}/disagreements`,
  );
  if (derived === undefined) {
    return undefined;
  }
  return { id, seat, reported, derived, disagreements };
}

function readLanes(ctx: Collector, value: unknown, path: string): Lane[] {
  if (!Array.isArray(value)) {
    ctx.add(path, "expected an array");
    return [];
  }
  if (value.length > MAX_LANES) {
    ctx.add(path, `expected at most ${MAX_LANES} lanes`);
    return [];
  }
  const lanes: Lane[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const lane = readLane(ctx, value[index], `${path}/${index}`);
    if (lane !== undefined) {
      lanes.push(lane);
    }
  }
  return lanes;
}

function readEnvelope(ctx: Collector, input: unknown): Envelope | undefined {
  const record = readClosedObject(ctx, input, "", ENVELOPE_KEYS);
  if (record === undefined) {
    return undefined;
  }
  if (own(record, "schema") !== SCHEMA) {
    ctx.add("/schema", `expected ${SCHEMA}`);
  }
  const project = readProjectId(ctx, own(record, "project"), "/project");
  const wave = readWaveId(ctx, own(record, "wave"), "/wave");
  const generatedAt =
    readTimestamp(ctx, own(record, "generatedAt"), "/generatedAt") ?? "";
  const intervalSeconds = readIntervalSeconds(
    ctx,
    own(record, "intervalSeconds"),
    "/intervalSeconds",
  );
  const lanes = readLanes(ctx, own(record, "lanes"), "/lanes");
  if (ctx.issues.length > 0) {
    return undefined;
  }
  return {
    schema: SCHEMA,
    project,
    wave,
    generatedAt,
    intervalSeconds,
    lanes,
  };
}

export function validateEnvelope(input: unknown): ValidationResult<Envelope> {
  const normalised = normalise(input, "envelope");
  if (!normalised.ok) {
    return { ok: false, errors: normalised.errors };
  }
  const ctx = new IssueCollector();
  const value = readEnvelope(ctx, normalised.value);
  if (value === undefined) {
    return { ok: false, errors: ctx.issues };
  }
  return { ok: true, value };
}
