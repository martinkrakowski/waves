import { readProjectId } from "./fields.js";
import { NOTICE_SCHEMA } from "./model.js";
import type { NoticeEvent } from "./model.js";
import {
  QUESTION_RULE,
  TEXT_RULE,
  readNoticeText,
  readRefs,
} from "./notice.js";
import type { Collector, ValidationResult } from "./validation.js";
import {
  IssueCollector,
  normalise,
  own,
  readClosedObject,
  readOptional,
  readTimestamp,
} from "./validation.js";

const EVENT_KEYS = [
  "schema",
  "kind",
  "project",
  "topic",
  "text",
  "detail",
  "at",
  "refs",
];

const TOPIC_RULE = { maxChars: 32, pattern: /^[a-z][a-z-]{0,31}$/ };

function readEvent(ctx: Collector, input: unknown): NoticeEvent | undefined {
  const record = readClosedObject(ctx, input, "", EVENT_KEYS);
  if (record === undefined) return undefined;

  if (own(record, "schema") !== NOTICE_SCHEMA) {
    ctx.add("/schema", `expected ${NOTICE_SCHEMA}`);
  }
  if (own(record, "kind") !== "event") {
    ctx.add("/kind", "expected event");
  }
  const project = readProjectId(ctx, own(record, "project"), "/project");
  const topic =
    readNoticeText(ctx, own(record, "topic"), "/topic", TOPIC_RULE) ?? "";
  const questionText =
    readNoticeText(ctx, own(record, "text"), "/text", QUESTION_RULE) ?? "";
  const detailRaw = own(record, "detail");
  const detail =
    detailRaw === undefined
      ? undefined
      : readNoticeText(ctx, detailRaw, "/detail", TEXT_RULE);
  const at = readTimestamp(ctx, own(record, "at"), "/at") ?? "";
  const refs = readOptional(ctx, own(record, "refs"), "/refs", readRefs);

  if (ctx.issues.length > 0) return undefined;

  return {
    schema: NOTICE_SCHEMA,
    kind: "event",
    project,
    topic,
    text: questionText,
    detail,
    at,
    refs,
  };
}

export function validateEvent(input: unknown): ValidationResult<NoticeEvent> {
  const normalised = normalise(input, "event");
  if (!normalised.ok) {
    return { ok: false, errors: normalised.errors };
  }
  const ctx = new IssueCollector();
  const value = readEvent(ctx, normalised.value);
  if (value === undefined) {
    return { ok: false, errors: ctx.issues };
  }
  return { ok: true, value };
}
