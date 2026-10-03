import type {
  Backlog,
  BacklogGit,
  BacklogScope,
  BacklogState,
  Premise,
  PremiseStatus,
} from "./model.js";
import {
  type Collector,
  type StringRule,
  own,
  readClosedObject,
  readEnum,
  readOptional,
  readText,
  readTimestamp,
} from "./validation.js";

const BACKLOG_KEYS = ["state", "at", "scope", "git", "premises"];
const SCOPE_KEYS = ["kind", "plans"];
const GIT_KEYS = ["branch", "head"];
const PREMISE_KEYS = ["lane", "plan", "status", "reason"];

const BACKLOG_STATES: readonly BacklogState[] = [
  "recorded",
  "absent",
  "unknown",
];
const SCOPE_KINDS = ["full", "partial"] as const;
const PREMISE_STATUSES: readonly PremiseStatus[] = [
  "holds",
  "stale",
  "timed-out",
  "error",
];

/** A project has a bounded number of plans; 64 names is already unreadable. */
const MAX_PLANS = 64;
const MAX_PLAN_CHARS = 120;
/** 255 characters is what a page can show; git's own limit for a ref is wider. */
const MAX_BRANCH_CHARS = 255;
/** One premise per lane, and a lane set is capped at 200 by the envelope too. */
const MAX_PREMISES = 200;
const MAX_PREMISE_CHARS = 120;
const MAX_REASON_CHARS = 500;

const HEAD_PATTERN = /^[0-9a-f]{7,64}$/;

const PLAN_RULE: StringRule = { minChars: 1, maxChars: MAX_PLAN_CHARS };
const BRANCH_RULE: StringRule = { minChars: 1, maxChars: MAX_BRANCH_CHARS };
const HEAD_RULE: StringRule = { pattern: HEAD_PATTERN };
const PREMISE_NAME_RULE: StringRule = {
  minChars: 1,
  maxChars: MAX_PREMISE_CHARS,
};
const REASON_RULE: StringRule = { minChars: 1, maxChars: MAX_REASON_CHARS };

function readPlans(ctx: Collector, value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    ctx.add(path, "expected an array");
    return [];
  }
  if (value.length > MAX_PLANS) {
    ctx.add(path, `expected at most ${MAX_PLANS} entries`);
    return [];
  }
  const plans: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const plan = readText(ctx, value[index], `${path}/${index}`, PLAN_RULE);
    if (plan !== undefined) {
      plans.push(plan);
    }
  }
  return plans;
}

function readScope(
  ctx: Collector,
  value: unknown,
  path: string,
): BacklogScope | undefined {
  const record = readClosedObject(ctx, value, path, SCOPE_KEYS);
  if (record === undefined) {
    return undefined;
  }
  return {
    kind:
      readEnum(ctx, own(record, "kind"), `${path}/kind`, SCOPE_KINDS) ?? "full",
    plans: readPlans(ctx, own(record, "plans"), `${path}/plans`),
  };
}

function readGit(
  ctx: Collector,
  value: unknown,
  path: string,
): BacklogGit | undefined {
  const record = readClosedObject(ctx, value, path, GIT_KEYS);
  if (record === undefined) {
    return undefined;
  }
  return {
    branch:
      readText(ctx, own(record, "branch"), `${path}/branch`, BRANCH_RULE) ?? "",
    head: readText(ctx, own(record, "head"), `${path}/head`, HEAD_RULE) ?? "",
  };
}

function readReason(
  ctx: Collector,
  value: unknown,
  path: string,
): string | undefined {
  return readText(ctx, value, path, REASON_RULE);
}

function readPremise(
  ctx: Collector,
  value: unknown,
  path: string,
): Premise | undefined {
  const record = readClosedObject(ctx, value, path, PREMISE_KEYS);
  if (record === undefined) {
    return undefined;
  }
  const lane =
    readText(ctx, own(record, "lane"), `${path}/lane`, PREMISE_NAME_RULE) ?? "";
  const plan =
    readText(ctx, own(record, "plan"), `${path}/plan`, PREMISE_NAME_RULE) ?? "";
  const status = readEnum<PremiseStatus>(
    ctx,
    own(record, "status"),
    `${path}/status`,
    PREMISE_STATUSES,
  );
  const reason = readOptional(
    ctx,
    own(record, "reason"),
    `${path}/reason`,
    readReason,
  );
  if (status === undefined) {
    return undefined;
  }
  return { lane, plan, status, reason };
}

function readPremises(ctx: Collector, value: unknown, path: string): Premise[] {
  if (!Array.isArray(value)) {
    ctx.add(path, "expected an array");
    return [];
  }
  if (value.length > MAX_PREMISES) {
    ctx.add(path, `expected at most ${MAX_PREMISES} entries`);
    return [];
  }
  const premises: Premise[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const premise = readPremise(ctx, value[index], `${path}/${index}`);
    if (premise !== undefined) {
      premises.push(premise);
    }
  }
  return premises;
}

export function readBacklog(
  ctx: Collector,
  value: unknown,
  path: string,
): Backlog | undefined {
  const record = readClosedObject(ctx, value, path, BACKLOG_KEYS);
  if (record === undefined) {
    return undefined;
  }
  return {
    state:
      readEnum<BacklogState>(
        ctx,
        own(record, "state"),
        `${path}/state`,
        BACKLOG_STATES,
      ) ?? "unknown",
    at: readOptional(ctx, own(record, "at"), `${path}/at`, readTimestamp),
    scope: readOptional(ctx, own(record, "scope"), `${path}/scope`, readScope),
    git: readOptional(ctx, own(record, "git"), `${path}/git`, readGit),
    premises: readOptional(
      ctx,
      own(record, "premises"),
      `${path}/premises`,
      readPremises,
    ),
  };
}
