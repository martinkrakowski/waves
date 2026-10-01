import { SCHEMA } from "@hexagen-monaco/waves-contract";

import { isRecord, own } from "./object.js";
import { truncateTail } from "./tail.js";

/**
 * What the client knows about the snapshot it is about to send: which project
 * and wave it is for, when the snapshot was taken, how often the project means
 * to push, and whether log tails are worth the bytes.
 */
export interface EnvelopeContext {
  readonly project: string;
  readonly wave: string;
  readonly generatedAt: string;
  readonly intervalSeconds: number | null;
  readonly includeTails: boolean;
}

/**
 * A candidate envelope. Its lanes are still `unknown` because the contract is
 * the only thing that turns them into lanes: `validateEnvelope` normalises
 * what this draft describes and the normalised value is what gets sent, so
 * nothing unvalidated ever reaches the wire.
 */
export interface EnvelopeDraft {
  readonly schema: string;
  readonly project: string;
  readonly wave: string;
  readonly generatedAt: string;
  readonly intervalSeconds: number | null;
  readonly lanes: readonly unknown[];
}

/** The strict ISO-8601 UTC form the contract accepts, with milliseconds. */
export function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * The lanes of the input, whether the input is a whole `waves/v1` envelope or
 * only the `{"lanes": [...]}` a project's reporter produces. `undefined` means
 * the input is not something this client can push at all.
 */
export function lanesOf(input: unknown): readonly unknown[] | undefined {
  if (!isRecord(input)) {
    return undefined;
  }
  const lanes = own(input, "lanes");
  return Array.isArray(lanes) ? lanes : undefined;
}

/**
 * Builds the envelope around the project's lanes. The client owns `schema`,
 * `project`, `wave`, `generatedAt` and `intervalSeconds` whatever the input
 * said: a snapshot is about this push, not about the moment the input file was
 * written.
 */
export function buildEnvelope(
  lanes: readonly unknown[],
  context: EnvelopeContext,
): EnvelopeDraft {
  return {
    schema: SCHEMA,
    project: context.project,
    wave: context.wave,
    generatedAt: context.generatedAt,
    intervalSeconds: context.intervalSeconds,
    lanes: applyTails(lanes, context.includeTails),
  };
}

/** Every lane, with its tail dropped or shortened according to the flag. */
export function applyTails(
  lanes: readonly unknown[],
  includeTails: boolean,
): unknown[] {
  return lanes.map((lane) => trimLaneTail(lane, includeTails));
}

/**
 * Returns the lane unchanged unless it carries a `derived.log.tail`. Nothing
 * here touches the caller's value: the affected lane, its `derived` and its
 * `log` are copied, so the parsed input stays exactly as the project wrote it.
 */
function trimLaneTail(lane: unknown, includeTails: boolean): unknown {
  if (!isRecord(lane)) {
    return lane;
  }
  const derived = own(lane, "derived");
  if (!isRecord(derived)) {
    return lane;
  }
  const log = own(derived, "log");
  if (!isRecord(log) || typeof own(log, "tail") !== "string") {
    return lane;
  }
  const nextLog = includeTails
    ? { ...log, tail: truncateTail(own(log, "tail") as string) }
    : withoutTail(log);
  return { ...lane, derived: { ...derived, log: nextLog } };
}

function withoutTail(log: Record<string, unknown>): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...log };
  delete rest["tail"];
  return rest;
}
