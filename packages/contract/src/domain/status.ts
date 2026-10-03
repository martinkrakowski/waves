import { readIntervalSeconds, readProjectId } from "./fields.js";
import { STATUS_SCHEMA } from "./model.js";
import type { PrsStatus, ProjectStatus } from "./model.js";
import { readBacklog } from "./status-backlog.js";
import {
  type Collector,
  type ValidationResult,
  IssueCollector,
  normalise,
  own,
  readClosedObject,
  readIntegerInRange,
  readOptional,
  readTimestamp,
} from "./validation.js";

const STATUS_KEYS = [
  "schema",
  "project",
  "generatedAt",
  "intervalSeconds",
  "prs",
  "backlog",
];
const PRS_KEYS = ["skipped"];

/** One listing per run, so the unread rows it could not have is small. */
const MAX_SKIPPED = 100_000;

function readPrs(
  ctx: Collector,
  value: unknown,
  path: string,
): PrsStatus | undefined {
  const record = readClosedObject(ctx, value, path, PRS_KEYS);
  if (record === undefined) {
    return undefined;
  }
  return {
    skipped:
      readIntegerInRange(
        ctx,
        own(record, "skipped"),
        `${path}/skipped`,
        0,
        MAX_SKIPPED,
      ) ?? 0,
  };
}

function readStatus(ctx: Collector, input: unknown): ProjectStatus | undefined {
  const record = readClosedObject(ctx, input, "", STATUS_KEYS);
  if (record === undefined) {
    return undefined;
  }
  if (own(record, "schema") !== STATUS_SCHEMA) {
    ctx.add("/schema", `expected ${STATUS_SCHEMA}`);
  }
  const project = readProjectId(ctx, own(record, "project"), "/project");
  const generatedAt =
    readTimestamp(ctx, own(record, "generatedAt"), "/generatedAt") ?? "";
  const intervalSeconds = readIntervalSeconds(
    ctx,
    own(record, "intervalSeconds"),
    "/intervalSeconds",
  );
  const prs = readOptional(ctx, own(record, "prs"), "/prs", readPrs);
  const backlog = readOptional(
    ctx,
    own(record, "backlog"),
    "/backlog",
    readBacklog,
  );
  if (ctx.issues.length > 0) {
    return undefined;
  }
  return {
    schema: STATUS_SCHEMA,
    project,
    generatedAt,
    intervalSeconds,
    prs,
    backlog,
  };
}

export function validateStatus(
  input: unknown,
): ValidationResult<ProjectStatus> {
  const normalised = normalise(input, "status");
  if (!normalised.ok) {
    return { ok: false, errors: normalised.errors };
  }
  const ctx = new IssueCollector();
  const value = readStatus(ctx, normalised.value);
  if (value === undefined) {
    return { ok: false, errors: ctx.issues };
  }
  return { ok: true, value };
}
