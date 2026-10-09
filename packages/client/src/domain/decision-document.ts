import { NOTICE_SCHEMA } from "@hexagen-monaco/waves-contract";

import { formatTimestamp } from "./envelope.js";
import { isRecord, own } from "./object.js";

/**
 * What `completeDecision` fills in: the project the session speaks for, and the
 * instant it did so, neither taken from the document the user gave.
 */
export interface DecisionContext {
  readonly project: string;
  readonly now: number;
}

export type CompleteDecisionResult =
  | { readonly ok: true; readonly document: Record<string, unknown> }
  | { readonly ok: false; readonly reason: string };

/**
 * Completes a draft decision before the contract is asked. The user supplies the
 * decision's own fields — the question, the options, the hard-to-undo flag — and
 * the client owns the keys that name which decision this is: its schema, its kind,
 * the project that raised it and the moment it was raised. Those are never read
 * from the document the user gave: a file that claims another project, or is not a
 * decision, is refused, because a decision is always about the project the session
 * holds a token for and always of this schema.
 *
 * Every other key is filled in only when the document did not give it, so a
 * document that already carries a `raisedAt` or a `shape` is left as the user
 * wrote it. The completed document is then handed to `validateDecision`.
 */
export function completeDecision(
  input: unknown,
  context: DecisionContext,
): CompleteDecisionResult {
  if (!isRecord(input)) {
    return { ok: false, reason: "the input is not a JSON object" };
  }
  const givenProject = own(input, "project");
  if (typeof givenProject === "string" && givenProject !== context.project) {
    return {
      ok: false,
      reason: `project ${givenProject} is not ${context.project}`,
    };
  }
  const document: Record<string, unknown> = { ...input };
  fillIfAbsent(document, "schema", NOTICE_SCHEMA);
  fillIfAbsent(document, "kind", "decision");
  fillIfAbsent(document, "project", context.project);
  fillIfAbsent(document, "shape", "choice");
  fillIfAbsent(document, "raisedAt", formatTimestamp(context.now));
  fillIfAbsent(document, "commits", []);
  fillIfAbsent(document, "appliesTo", []);
  fillIfAbsent(document, "evidence", []);
  fillIfAbsent(document, "options", []);
  return { ok: true, document };
}

/**
 * Sets `key` to `value` only when the document does not carry it. `Object.hasOwn`
 * is used rather than a truthiness test so that a key present with any value —
 * including `null`, which the strict notice reader refuses in its own way — is
 * never overwritten.
 */
function fillIfAbsent(
  record: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (!Object.hasOwn(record, key)) {
    record[key] = value;
  }
}
