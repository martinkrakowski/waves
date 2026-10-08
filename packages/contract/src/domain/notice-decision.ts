import { readProjectId } from "./fields.js";
import { NOTICE_SCHEMA, MAX_RAISED_BY_CHARS } from "./model.js";
import type { DecisionRevision, DoorValue } from "./model.js";
import {
  QUESTION_RULE,
  TEXT_RULE,
  readNoticeText,
  readRefs,
} from "./notice.js";
import {
  DECISION_KEYS,
  DECISION_SHAPES,
  DECIDERS,
  applyShapeRules,
  readActElsewhere,
  readCommits,
  readAppliesTo,
  readEvidence,
  readHardToUndo,
  readLaneId,
  readOptions,
  readRecommended,
} from "./notice-decision-readers.js";
import type { HardToUndo } from "./notice-decision-readers.js";
import type { Collector, ValidationResult } from "./validation.js";
import {
  IssueCollector,
  normalise,
  own,
  readClosedObject,
  readEnum,
  readOptional,
  readTimestamp,
} from "./validation.js";

const RAISED_BY_RULE = { minChars: 1, maxChars: MAX_RAISED_BY_CHARS };

function readDecision(
  ctx: Collector,
  input: unknown,
): DecisionRevision | undefined {
  const record = readClosedObject(ctx, input, "", DECISION_KEYS);
  if (record === undefined) return undefined;

  if (own(record, "schema") !== NOTICE_SCHEMA) {
    ctx.add("/schema", `expected ${NOTICE_SCHEMA}`);
  }
  if (own(record, "kind") !== "decision") {
    ctx.add("/kind", "expected decision");
  }
  const project = readProjectId(ctx, own(record, "project"), "/project");
  const id = readLaneId(ctx, own(record, "id"), "/id");
  const shape =
    readEnum(ctx, own(record, "shape"), "/shape", DECISION_SHAPES) ?? "choice";
  const question =
    readNoticeText(ctx, own(record, "question"), "/question", QUESTION_RULE) ??
    "";
  const { options, optionKeys } = readOptions(
    ctx,
    own(record, "options"),
    "/options",
  );
  const recommendedRaw = own(record, "recommended");
  const recommended =
    recommendedRaw === undefined
      ? undefined
      : readRecommended(ctx, recommendedRaw, "/recommended", optionKeys);
  const hardToUndo =
    readHardToUndo(ctx, own(record, "hardToUndo"), "/hardToUndo") ??
    ({ value: false } as HardToUndo);
  const commits = readCommits(ctx, own(record, "commits"), "/commits");
  const decider =
    readEnum(ctx, own(record, "decider"), "/decider", DECIDERS) ?? "owner";
  const appliesTo = readAppliesTo(ctx, own(record, "appliesTo"), "/appliesTo");
  const evidence = readEvidence(ctx, own(record, "evidence"), "/evidence");
  const actElsewhereRaw = own(record, "actElsewhere");
  const actElsewhere = readOptional(
    ctx,
    actElsewhereRaw,
    "/actElsewhere",
    readActElsewhere,
  );
  const raisedBy =
    readNoticeText(ctx, own(record, "raisedBy"), "/raisedBy", RAISED_BY_RULE) ??
    "";
  const raisedAt =
    readTimestamp(ctx, own(record, "raisedAt"), "/raisedAt") ?? "";
  const refs = readOptional(ctx, own(record, "refs"), "/refs", readRefs);
  const changeNote = readOptional(
    ctx,
    own(record, "changeNote"),
    "/changeNote",
    (c, v, p) => readNoticeText(c, v, p, TEXT_RULE),
  );

  applyShapeRules(
    ctx,
    shape,
    options,
    recommendedRaw !== undefined,
    appliesTo,
    actElsewhereRaw !== undefined,
  );

  if (ctx.issues.length > 0) return undefined;

  return {
    schema: NOTICE_SCHEMA,
    kind: "decision",
    project,
    id,
    shape,
    question,
    options,
    recommended,
    hardToUndo,
    commits,
    decider,
    appliesTo,
    evidence,
    actElsewhere,
    raisedBy,
    raisedAt,
    refs,
    changeNote,
  };
}

export function validateDecision(
  input: unknown,
): ValidationResult<DecisionRevision> {
  const normalised = normalise(input, "decision");
  if (!normalised.ok) {
    return { ok: false, errors: normalised.errors };
  }
  const ctx = new IssueCollector();
  const value = readDecision(ctx, normalised.value);
  if (value === undefined) {
    return { ok: false, errors: ctx.issues };
  }
  return { ok: true, value };
}

export function decisionBindingText(revision: DecisionRevision): string {
  const recommended = revision.recommended ?? null;
  const hardToUndo: { value: DoorValue; reason: string | null } = {
    value: revision.hardToUndo.value,
    reason: revision.hardToUndo.reason ?? null,
  };
  const actElsewhere = revision.actElsewhere ?? null;
  const binding = {
    question: revision.question,
    shape: revision.shape,
    options: revision.options,
    recommended,
    hardToUndo,
    commits: revision.commits,
    decider: revision.decider,
    appliesTo: revision.appliesTo,
    actElsewhere,
  };
  return JSON.stringify(binding);
}
