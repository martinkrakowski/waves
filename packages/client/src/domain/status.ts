import { STATUS_SCHEMA } from "@hexagen-monaco/waves-contract";

import { isRecord } from "./object.js";

/**
 * What the client knows about the status it is about to send: which project it
 * is for, when it was collected, and how often the project means to push.
 */
export interface StatusContext {
  readonly project: string;
  readonly generatedAt: string;
  readonly intervalSeconds: number | null;
}

/**
 * The candidate status document, or `undefined` when the input is not a JSON
 * object at all — which is the one mistake worth naming before the contract
 * does, because every other mistake it names itself.
 *
 * `prs` and `backlog` are the two optional parts, and a document carrying
 * neither is valid: it says the project is alive with nothing to report. There
 * is no `lanes` here to key the input on, so the whole input object is carried
 * through and the contract is left to refuse a key it does not know. That is
 * deliberate, and it is the opposite of what `buildEnvelope` does with a wave:
 * keeping only `prs` and `backlog` would accept a misspelt `backlogg` as a
 * status with nothing to report, and say so by storing it.
 */
export function buildStatus(
  input: unknown,
  context: StatusContext,
): Record<string, unknown> | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  return {
    ...input,
    schema: STATUS_SCHEMA,
    project: context.project,
    generatedAt: context.generatedAt,
    intervalSeconds: context.intervalSeconds,
  };
}
