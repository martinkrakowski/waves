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

/**
 * What `buildStateEntry` needs from the command line and the session: the
 * decision's id is in the URL, the project is the session's, and `now` is the
 * client's clock.
 */
export interface StateEntryContext {
  readonly project: string;
  readonly now: number;
}

/** The flags the user gave for a state entry, all of them parsed to types. */
export interface StateEntryInput {
  readonly state: string;
  readonly source: "reported" | "session";
  readonly revision: number;
  readonly textSha256: string;
  readonly expectedEntries: number;
  readonly by: string | undefined;
  readonly words: string | undefined;
  readonly option: string | undefined;
  readonly reason: string | undefined;
  readonly supersededBy: string | undefined;
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
 * Builds a state entry from the flags a `report` or `state` command parsed and
 * the session's own values. `by` defaults to `<project> session`, `at` to the
 * client's clock in the contract's form, and `source` is fixed by the command.
 * Every optional key is always present on the result, carried as `undefined` when
 * the user did not give it — which `JSON.stringify` drops and `validateStateEntry`
 * reads as "absent", so neither the wire nor the validator ever sees a key that
 * was not really given.
 */
export function buildStateEntry(
  input: StateEntryInput,
  context: StateEntryContext,
): Record<string, unknown> {
  return {
    state: input.state,
    source: input.source,
    revision: input.revision,
    textSha256: input.textSha256,
    expectedEntries: input.expectedEntries,
    by: input.by ?? `${context.project} session`,
    at: formatTimestamp(context.now),
    words: input.words,
    option: input.option,
    reason: input.reason,
    supersededBy: input.supersededBy,
  };
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
