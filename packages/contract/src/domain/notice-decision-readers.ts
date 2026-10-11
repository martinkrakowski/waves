import { isLaneId, type ProjectId } from "./ids.js";
import { readProjectId } from "./fields.js";
import { applyAnswerRules, readAnswerSignature } from "./notice-answer.js";
import type {
  AnswerVerdict,
  DecisionOption,
  DecisionState,
  DoorValue,
  NoticeEvidence,
  StateSource,
  StoredStateEntry,
} from "./model.js";
import {
  MAX_OPTIONS,
  MAX_COMMITS,
  MAX_EVIDENCE,
  MAX_APPLIES_TO,
  MAX_TEXT_CHARS,
} from "./model.js";
import {
  TEXT_RULE,
  LABEL_RULE,
  SHA256_RULE,
  readNoticeText,
  readOptionKey,
} from "./notice.js";
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

const ANSWER_STATES = new Set(["approved", "declined", "answered"]);

const SESSION_STATES = new Set(["delegated", "withdrawn", "superseded"]);

export const DECISION_KEYS = [
  "schema",
  "kind",
  "project",
  "id",
  "shape",
  "question",
  "options",
  "recommended",
  "hardToUndo",
  "commits",
  "decider",
  "appliesTo",
  "evidence",
  "actElsewhere",
  "raisedBy",
  "raisedAt",
  "refs",
  "changeNote",
];
const OPTION_KEYS = ["key", "text", "cost"];
const RECOMMENDED_KEYS = ["option", "reason"];
export const HARD_TO_UNDO_KEYS = ["value", "reason"];
const ACT_ELSEWHERE_KEYS = ["where", "what"];
const EVIDENCE_KEYS = ["label", "href"];
export const DECISION_SHAPES = ["choice", "action", "instruction"] as const;
export const DECIDERS = ["owner", "delegated"] as const;

export function readLaneId(
  ctx: Collector,
  value: unknown,
  path: string,
): string {
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

export function readDoorValue(
  ctx: Collector,
  value: unknown,
  path: string,
): DoorValue | undefined {
  if (typeof value === "boolean") return value;
  if (value === "partly") return "partly";
  ctx.add(path, 'expected true, false or "partly"');
  return undefined;
}

function readHref(
  ctx: Collector,
  value: unknown,
  path: string,
): string | undefined {
  const text = readNoticeText(ctx, value, path, {
    minChars: 1,
    maxChars: MAX_TEXT_CHARS,
  });
  if (text === undefined) return undefined;
  if (!text.startsWith("https://")) {
    ctx.add(path, "expected an https URL");
    return undefined;
  }
  if (/\s/.test(text)) {
    ctx.add(path, "expected no white space");
    return undefined;
  }
  return text;
}

function readOption(
  ctx: Collector,
  value: unknown,
  path: string,
  existingKeys: Set<string>,
): DecisionOption | undefined {
  const record = readClosedObject(ctx, value, path, OPTION_KEYS);
  if (record === undefined) return undefined;
  const key = readOptionKey(ctx, own(record, "key"), `${path}/key`);
  const text = readNoticeText(
    ctx,
    own(record, "text"),
    `${path}/text`,
    TEXT_RULE,
  );
  const cost = readNoticeText(
    ctx,
    own(record, "cost"),
    `${path}/cost`,
    TEXT_RULE,
  );
  if (key === undefined || text === undefined || cost === undefined)
    return undefined;
  if (existingKeys.has(key)) {
    ctx.add(`${path}/key`, "duplicate option key");
    return undefined;
  }
  return { key, text, cost };
}

export function readOptions(
  ctx: Collector,
  value: unknown,
  path: string,
): { options: DecisionOption[]; optionKeys: Set<string> } {
  if (!Array.isArray(value)) {
    ctx.add(path, "expected an array");
    return { options: [], optionKeys: new Set() };
  }
  if (value.length > MAX_OPTIONS) {
    ctx.add(path, `expected at most ${MAX_OPTIONS} entries`);
    return { options: [], optionKeys: new Set() };
  }
  const options: DecisionOption[] = [];
  const optionKeys = new Set<string>();
  for (let i = 0; i < value.length; i += 1) {
    const option = readOption(ctx, value[i], `${path}/${i}`, optionKeys);
    if (option !== undefined) {
      options.push(option);
      optionKeys.add(option.key);
    }
  }
  return { options, optionKeys };
}

export function readRecommended(
  ctx: Collector,
  value: unknown,
  path: string,
  optionKeys: Set<string>,
): { option: string; reason: string } | undefined {
  const record = readClosedObject(ctx, value, path, RECOMMENDED_KEYS);
  if (record === undefined) return undefined;
  const option = readOptionKey(ctx, own(record, "option"), `${path}/option`);
  const reason = readNoticeText(
    ctx,
    own(record, "reason"),
    `${path}/reason`,
    TEXT_RULE,
  );
  if (option === undefined || reason === undefined) return undefined;
  if (!optionKeys.has(option)) {
    ctx.add(
      `${path}/option`,
      "expected an option key from the decision's options",
    );
    return undefined;
  }
  return { option, reason };
}

export type HardToUndo = { value: DoorValue; reason?: string };

export function readHardToUndo(
  ctx: Collector,
  value: unknown,
  path: string,
): HardToUndo | undefined {
  const record = readClosedObject(ctx, value, path, HARD_TO_UNDO_KEYS);
  if (record === undefined) return undefined;
  const val = readDoorValue(ctx, own(record, "value"), `${path}/value`);
  const reasonRaw = own(record, "reason");
  const reason =
    reasonRaw === undefined
      ? undefined
      : readNoticeText(ctx, reasonRaw, `${path}/reason`, TEXT_RULE);
  if (val !== undefined && val !== false && reasonRaw === undefined) {
    ctx.add(`${path}/reason`, "expected a reason");
  }
  if (val === undefined) return undefined;
  return { value: val, reason };
}

export function readCommits(
  ctx: Collector,
  value: unknown,
  path: string,
): string[] {
  if (!Array.isArray(value)) {
    ctx.add(path, "expected an array");
    return [];
  }
  if (value.length > MAX_COMMITS) {
    ctx.add(path, `expected at most ${MAX_COMMITS} entries`);
    return [];
  }
  const commits: string[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const c = readNoticeText(ctx, value[i], `${path}/${i}`, TEXT_RULE);
    if (c !== undefined) commits.push(c);
  }
  return commits;
}

export function readAppliesTo(
  ctx: Collector,
  value: unknown,
  path: string,
): ProjectId[] {
  if (!Array.isArray(value)) {
    ctx.add(path, "expected an array");
    return [];
  }
  if (value.length > MAX_APPLIES_TO) {
    ctx.add(path, `expected at most ${MAX_APPLIES_TO} entries`);
    return [];
  }
  const result: ProjectId[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < value.length; i += 1) {
    const project = readProjectId(ctx, value[i], `${path}/${i}`);
    if (project === "") continue;
    if (seen.has(project)) {
      ctx.add(`${path}/${i}`, "duplicate project id");
    } else {
      result.push(project);
      seen.add(project);
    }
  }
  return result;
}

export function readEvidence(
  ctx: Collector,
  value: unknown,
  path: string,
): NoticeEvidence[] {
  if (!Array.isArray(value)) {
    ctx.add(path, "expected an array");
    return [];
  }
  if (value.length > MAX_EVIDENCE) {
    ctx.add(path, `expected at most ${MAX_EVIDENCE} entries`);
    return [];
  }
  const evidence: NoticeEvidence[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const record = readClosedObject(
      ctx,
      value[i],
      `${path}/${i}`,
      EVIDENCE_KEYS,
    );
    if (record === undefined) continue;
    const label = readNoticeText(
      ctx,
      own(record, "label"),
      `${path}/${i}/label`,
      LABEL_RULE,
    );
    const href = readHref(ctx, own(record, "href"), `${path}/${i}/href`);
    if (label !== undefined && href !== undefined) {
      evidence.push({ label, href });
    }
  }
  return evidence;
}

export type ActElsewhere = { where: string; what: string };

export function readActElsewhere(
  ctx: Collector,
  value: unknown,
  path: string,
): ActElsewhere | undefined {
  const record = readClosedObject(ctx, value, path, ACT_ELSEWHERE_KEYS);
  if (record === undefined) return undefined;
  const where = readNoticeText(
    ctx,
    own(record, "where"),
    `${path}/where`,
    TEXT_RULE,
  );
  const what = readNoticeText(
    ctx,
    own(record, "what"),
    `${path}/what`,
    TEXT_RULE,
  );
  if (where === undefined || what === undefined) return undefined;
  return { where, what };
}

export function applyShapeRules(
  ctx: Collector,
  shape: string,
  optionCount: number | undefined,
  recommendedPresent: boolean,
  appliesTo: ProjectId[],
  actElsewherePresent: boolean,
): void {
  if (shape === "choice") {
    if (optionCount !== undefined && optionCount < 2) {
      ctx.add("/options", "expected at least 2 options for a choice");
    }
  } else if (optionCount !== undefined && optionCount > 0) {
    ctx.add("/options", `expected no options for a ${shape}`);
  }
  if (shape !== "choice" && recommendedPresent) {
    ctx.add("/recommended", `expected no recommended for a ${shape}`);
  }
  if (shape === "action" && !actElsewherePresent) {
    ctx.add("/actElsewhere", "expected actElsewhere for an action");
  }
  if (shape === "instruction" && appliesTo.length === 0) {
    ctx.add("/appliesTo", "expected at least one entry for an instruction");
  }
}

const STORED_ENTRY_KEYS = [
  "state",
  "source",
  "revision",
  "textSha256",
  "by",
  "at",
  "words",
  "option",
  "reason",
  "supersededBy",
  "signature",
];

const STORED_SOURCES = ["session", "reported", "signed"] as const;

const STORED_STATES = [
  "delegated",
  "approved",
  "declined",
  "answered",
  "withdrawn",
  "superseded",
] as const;

/**
 * What a stored entry says about itself: the same source-by-state table the
 * session route enforces (W57), plus the rule stage 2 adds — `signed` is an
 * answer state only, it comes with a `signature`, and no other source's entry
 * carries one.
 */
function applyStoredSourceRules(
  ctx: Collector,
  state: string,
  source: string | undefined,
  wordsPresent: boolean,
  reasonPresent: boolean,
  optionPresent: boolean,
  supersededByPresent: boolean,
  signaturePresent: boolean,
): void {
  if (source === undefined) return;
  if (ANSWER_STATES.has(state)) {
    if (source === "session") {
      ctx.add("/source", "expected reported or signed for an answer state");
    }
    if (source === "reported" && !wordsPresent) {
      ctx.add("/words", "expected words for a reported answer");
    }
  } else if (SESSION_STATES.has(state) && source !== "session") {
    ctx.add("/source", "expected session for this state");
  }
  if (state === "delegated" && !optionPresent && !wordsPresent) {
    ctx.add("/option", "expected option or words for a delegated state");
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
  if (source === "signed" && !signaturePresent) {
    ctx.add("/signature", "expected a signature for a signed entry");
  }
  if (source !== "signed" && signaturePresent) {
    ctx.add("/signature", "expected no signature for this source");
  }
  if (source === "signed" && ANSWER_STATES.has(state)) {
    applyAnswerRules(
      ctx,
      state as AnswerVerdict,
      optionPresent,
      wordsPresent,
      "/state",
    );
  }
}

function readStoredStateEntry(
  ctx: Collector,
  input: unknown,
): StoredStateEntry | undefined {
  const record = readClosedObject(ctx, input, "", STORED_ENTRY_KEYS);
  if (record === undefined) return undefined;

  const state = readEnum(ctx, own(record, "state"), "/state", STORED_STATES);
  const source = readEnum(
    ctx,
    own(record, "source"),
    "/source",
    STORED_SOURCES,
  );
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
  const by = readNoticeText(ctx, own(record, "by"), "/by", LABEL_RULE);
  const at = readTimestamp(ctx, own(record, "at"), "/at");
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
    readLaneId,
  );
  const signature = readOptional(
    ctx,
    own(record, "signature"),
    "/signature",
    readAnswerSignature,
  );

  applyStoredSourceRules(
    ctx,
    state ?? "",
    source,
    wordsRaw !== undefined,
    reasonRaw !== undefined,
    own(record, "option") !== undefined,
    own(record, "supersededBy") !== undefined,
    own(record, "signature") !== undefined,
  );

  if (ctx.issues.length > 0) return undefined;

  return {
    state: state as DecisionState,
    source: source as StateSource,
    revision: revision!,
    textSha256: textSha256!,
    by: by!,
    at: at!,
    words,
    option,
    reason,
    supersededBy,
    signature,
  };
}

/**
 * One state entry as the store holds it, against the rules of design 4.2 and
 * the stored half of W61. This is the entry a route reads back, not the body a
 * session posts: it has no `expectedEntries`, and it is the only place
 * `source: "signed"` is accepted.
 */
export function validateStoredStateEntry(
  input: unknown,
): ValidationResult<StoredStateEntry> {
  const normalised = normalise(input, "stored state entry");
  if (!normalised.ok) {
    return { ok: false, errors: normalised.errors };
  }
  const ctx = new IssueCollector();
  const value = readStoredStateEntry(ctx, normalised.value);
  if (value === undefined) {
    return { ok: false, errors: ctx.issues };
  }
  return { ok: true, value };
}
