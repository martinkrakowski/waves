import { TEXT_RULE, readNoticeText, readOptionKey } from "./notice.js";
import { isLaneId } from "./ids.js";
import type { StateEntryRequest, DecisionState } from "./model.js";
import type { Collector, ValidationResult } from "./validation.js";
import {
  IssueCollector,
  normalise,
  own,
  readClosedObject,
  readEnum,
  readIntegerAtLeast,
  readOptional,
  readText,
  readTimestamp,
} from "./validation.js";

const STATE_ENTRY_KEYS = [
  "state",
  "source",
  "revision",
  "textSha256",
  "expectedEntries",
  "by",
  "at",
  "words",
  "option",
  "reason",
  "supersededBy",
];

const STATE_SOURCES = ["session", "reported"] as const;

const WRITABLE_STATES = [
  "delegated",
  "approved",
  "declined",
  "answered",
  "withdrawn",
  "superseded",
] as const;

const BY_RULE = { minChars: 1, maxChars: 80 };
const SHA256_RULE = { pattern: /^[0-9a-f]{64}$/ };

function readLaneIdRef(
  ctx: Collector,
  value: unknown,
  path: string,
): string | undefined {
  if (typeof value !== "string") {
    ctx.add(path, "expected a lane id");
    return undefined;
  }
  if (!isLaneId(value)) {
    ctx.add(path, "expected 1 to 80 characters of A-Z, a-z, 0-9, _ and -");
    return undefined;
  }
  return value;
}

function applySourceRules(
  ctx: Collector,
  state: string,
  source: string | undefined,
  option: string | undefined,
  optionPresent: boolean,
  words: string | undefined,
  wordsPresent: boolean,
  reason: string | undefined,
  reasonPresent: boolean,
  supersededBy: string | undefined,
  supersededByPresent: boolean,
): void {
  const answers = new Set(["approved", "declined", "answered"]);
  const sessionStates = new Set(["delegated", "withdrawn", "superseded"]);

  if (answers.has(state)) {
    if (source !== "reported") {
      ctx.add("/source", "expected reported for an answer state");
    }
    if (!wordsPresent) {
      ctx.add("/words", "expected words for a reported answer");
    }
  }
  if (sessionStates.has(state)) {
    if (source !== "session") {
      ctx.add("/source", "expected session for this state");
    }
  }
  if (state === "delegated") {
    if (!optionPresent && !wordsPresent) {
      ctx.add("/option", "expected option or words for a delegated state");
    }
  }
  if (state === "withdrawn" && !reasonPresent) {
    ctx.add("/reason", "expected a reason for a withdrawn state");
  }
  if (state === "superseded" && !supersededByPresent) {
    ctx.add("/supersededBy", "expected supersededBy for a superseded state");
  }
  if (state !== "superseded" && supersededByPresent) {
    ctx.add("/supersededBy", "expected no supersededBy for this state");
  }
}

function readStateEntry(
  ctx: Collector,
  input: unknown,
): StateEntryRequest | undefined {
  const record = readClosedObject(ctx, input, "", STATE_ENTRY_KEYS);
  if (record === undefined) return undefined;

  const state = readEnum(ctx, own(record, "state"), "/state", WRITABLE_STATES);
  const source = readEnum(ctx, own(record, "source"), "/source", STATE_SOURCES);
  const revision = readIntegerAtLeast(
    ctx,
    own(record, "revision"),
    "/revision",
    1,
  );
  const textSha256 = readText(
    ctx,
    own(record, "textSha256"),
    "/textSha256",
    SHA256_RULE,
  );
  const expectedEntries = readIntegerAtLeast(
    ctx,
    own(record, "expectedEntries"),
    "/expectedEntries",
    0,
  );
  const by = readNoticeText(ctx, own(record, "by"), "/by", BY_RULE) ?? "";
  const at = readTimestamp(ctx, own(record, "at"), "/at") ?? "";
  const wordsRaw = own(record, "words");
  const words =
    wordsRaw === undefined
      ? undefined
      : readNoticeText(ctx, wordsRaw, "/words", TEXT_RULE);
  const option = readOptional(
    ctx,
    own(record, "option"),
    "/option",
    readOptionKey,
  );
  const reasonRaw = own(record, "reason");
  const reason =
    reasonRaw === undefined
      ? undefined
      : readNoticeText(ctx, reasonRaw, "/reason", TEXT_RULE);
  const supersededBy = readOptional(
    ctx,
    own(record, "supersededBy"),
    "/supersededBy",
    readLaneIdRef,
  );

  applySourceRules(
    ctx,
    state ?? "",
    source,
    option,
    own(record, "option") !== undefined,
    words,
    wordsRaw !== undefined,
    reason,
    reasonRaw !== undefined,
    supersededBy,
    own(record, "supersededBy") !== undefined,
  );

  if (ctx.issues.length > 0) return undefined;

  return {
    state: (state ?? "") as DecisionState,
    source: source ?? "session",
    revision: revision ?? 0,
    textSha256: textSha256 ?? "",
    expectedEntries: expectedEntries ?? 0,
    by,
    at,
    words,
    option,
    reason,
    supersededBy,
  };
}

export function validateStateEntry(
  input: unknown,
): ValidationResult<StateEntryRequest> {
  const normalised = normalise(input, "state entry");
  if (!normalised.ok) {
    return { ok: false, errors: normalised.errors };
  }
  const ctx = new IssueCollector();
  const value = readStateEntry(ctx, normalised.value);
  if (value === undefined) {
    return { ok: false, errors: ctx.issues };
  }
  return { ok: true, value };
}
