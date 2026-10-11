import { isLaneId, isWaveId } from "./ids.js";
import type { NoticeRefs } from "./model.js";
import {
  type Collector,
  type StringRule,
  own,
  readClosedObject,
  readIntegerAtLeast,
  readOptional,
  readText,
} from "./validation.js";

import { MAX_LABEL_CHARS } from "./model.js";
import { MAX_TEXT_CHARS } from "./model.js";
import { MAX_QUESTION_CHARS } from "./model.js";

const REFS_KEYS = ["wave", "lane", "pr"];

export const QUESTION_RULE: StringRule = {
  minChars: 1,
  maxChars: MAX_QUESTION_CHARS,
};
export const TEXT_RULE: StringRule = { minChars: 1, maxChars: MAX_TEXT_CHARS };
export const LABEL_RULE: StringRule = {
  minChars: 1,
  maxChars: MAX_LABEL_CHARS,
};
export const OPTION_KEY_RULE: StringRule = {
  pattern: /^[a-z0-9]{1,8}$/,
};
export const SHA256_RULE: StringRule = { pattern: /^[0-9a-f]{64}$/ };
export const TOPIC_RULE: StringRule = {
  maxChars: 32,
  pattern: /^[a-z][a-z-]{0,31}$/,
};

/** A strict text reader for the notice document: refuses non-NFC and strings
 * with leading or trailing white space, never repairing them. */
export function readNoticeText(
  ctx: Collector,
  value: unknown,
  path: string,
  rule: StringRule,
): string | undefined {
  const text = readText(ctx, value, path, rule);
  if (text === undefined) {
    return undefined;
  }
  if (text.normalize("NFC") !== text) {
    ctx.add(path, "expected NFC-normalised text");
    return undefined;
  }
  if (/^[\s\u0085]/.test(text) || /[\s\u0085]$/u.test(text)) {
    ctx.add(path, "expected no leading or trailing white space");
    return undefined;
  }
  return text;
}

export function readOptionKey(
  ctx: Collector,
  value: unknown,
  path: string,
): string | undefined {
  return readNoticeText(ctx, value, path, OPTION_KEY_RULE);
}

function readWaveIdRef(
  ctx: Collector,
  value: unknown,
  path: string,
): string | undefined {
  if (typeof value !== "string") {
    ctx.add(path, "expected a wave id");
    return undefined;
  }
  if (!isWaveId(value)) {
    ctx.add(path, "expected 1 to 80 characters of A-Z, a-z, 0-9, _ and -");
    return undefined;
  }
  return value;
}

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

export function readRefs(
  ctx: Collector,
  value: unknown,
  path: string,
): NoticeRefs | undefined {
  const record = readClosedObject(ctx, value, path, REFS_KEYS);
  if (record === undefined) {
    return undefined;
  }
  return {
    wave: readOptional(ctx, own(record, "wave"), `${path}/wave`, readWaveIdRef),
    lane: readOptional(ctx, own(record, "lane"), `${path}/lane`, readLaneIdRef),
    pr: readOptional(ctx, own(record, "pr"), `${path}/pr`, (c, v, p) =>
      readIntegerAtLeast(c, v, p, 1),
    ),
  };
}
