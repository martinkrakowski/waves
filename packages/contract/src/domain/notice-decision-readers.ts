import { isLaneId, type ProjectId } from "./ids.js";
import { readProjectId } from "./fields.js";
import type { DecisionOption, DoorValue, NoticeEvidence } from "./model.js";
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
  readNoticeText,
  readOptionKey,
} from "./notice.js";
import type { Collector } from "./validation.js";
import { own, readClosedObject } from "./validation.js";

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
  optionCount: number,
  recommendedPresent: boolean,
  appliesTo: ProjectId[],
  actElsewherePresent: boolean,
): void {
  if (shape === "choice") {
    if (optionCount < 2) {
      ctx.add("/options", "expected at least 2 options for a choice");
    }
  } else if (optionCount > 0) {
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
