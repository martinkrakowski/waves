import { isLaneId } from "@hexagen-monaco/waves-contract";

import { isRecord, own } from "./object.js";
import { parseObject } from "./reply.js";

const ANSWERED_STATES = ["approved", "declined", "answered"];
const REPORTED_SOURCE = "reported";
const ANSWER_PREFIX = "reported, not signed";

/** The fields the export needs from a decisions-list head, checked and typed. */
export interface HeadInfo {
  readonly id: string;
  readonly question: string;
  readonly state: string;
  readonly source: string | undefined;
  readonly at: string | undefined;
  readonly revision: number;
  readonly textSha256: string;
}

/** The current entry's verdict details, read from the full decision. */
export interface EntryInfo {
  readonly option: string | undefined;
  readonly words: string | undefined;
  readonly receivedAt: string | undefined;
}

export interface DecisionRecord {
  readonly head: HeadInfo;
  readonly entry: EntryInfo | undefined;
}

/**
 * Reads the heads of a project's decisions from the list response.
 *
 * A head that belongs to another project (carries a `from`) is skipped: a list
 * that mixes this project's heads with another's is still usable. But a value
 * that is not otherwise a valid head, or whose `id` is not a lane id, makes the
 * whole response unusable — `None.` is never printed for a response the server
 * could not mean to send for this project.
 */
export function readHeads(body: string): readonly HeadInfo[] | undefined {
  const parsed = parseObject(body);
  if (parsed === undefined) {
    return undefined;
  }
  const decisions = own(parsed, "decisions");
  if (!Array.isArray(decisions)) {
    return undefined;
  }
  const heads: HeadInfo[] = [];
  for (const value of decisions) {
    // A head that carries a `from` belongs to another project: it is exported by
    // that project, never this one, so it is skipped rather than refused, and a
    // list that mixes this project's heads with another's is still usable.
    if (isRecord(value) && own(value, "from") !== undefined) {
      continue;
    }
    const head = readHead(value);
    if (head === undefined) {
      // A member that is not one of this project's heads is not something the
      // body the server sent could mean for this project: the response is
      // unusable, never half-parsed.
      return undefined;
    }
    // An id that is not a lane id is not a safe path segment: `..` would survive
    // encodeURIComponent and be normalised away, so the response is unusable.
    if (!isLaneId(head.id)) {
      return undefined;
    }
    heads.push(head);
  }
  return heads;
}

function readHead(value: unknown): HeadInfo | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = own(value, "id");
  const question = own(value, "question");
  const state = own(value, "state");
  const source = own(value, "source");
  const at = own(value, "at");
  const revision = own(value, "revision");
  const textSha256 = own(value, "textSha256");
  if (
    typeof id !== "string" ||
    typeof question !== "string" ||
    typeof state !== "string" ||
    typeof revision !== "number" ||
    !Number.isInteger(revision) ||
    typeof textSha256 !== "string" ||
    (source !== undefined && typeof source !== "string") ||
    (at !== undefined && typeof at !== "string")
  ) {
    return undefined;
  }
  return { id, question, state, source, at, revision, textSha256 };
}

/**
 * Reads one decision's full record: the head and the current entry, which is the
 * last state entry on the head's `textSha256` whose `state` is the head's and
 * whose `source` is `reported` — the verdict that backs that head. The entry is
 * required: a head that claims an answer but has no matching entry is not one
 * this service printed, so `undefined` only means the body is not the shape the
 * route should answer.
 */
export function readRecord(body: string): DecisionRecord | undefined {
  const parsed = parseObject(body);
  if (parsed === undefined) {
    return undefined;
  }
  const head = readHead(own(parsed, "head"));
  if (head === undefined) {
    return undefined;
  }
  const entries = own(parsed, "entries");
  const entry = Array.isArray(entries)
    ? findCurrentEntry(entries, head.textSha256, head.state)
    : undefined;
  return { head, entry };
}

function findCurrentEntry(
  entries: readonly unknown[],
  textSha256: string,
  state: string,
): EntryInfo | undefined {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = readEntry(entries[i], textSha256, state);
    if (entry !== undefined) {
      return entry;
    }
  }
  return undefined;
}

function readEntry(
  value: unknown,
  expectedHash: string,
  expectedState: string,
): EntryInfo | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    own(value, "textSha256") !== expectedHash ||
    own(value, "state") !== expectedState ||
    own(value, "source") !== REPORTED_SOURCE
  ) {
    return undefined;
  }
  const option = own(value, "option");
  const words = own(value, "words");
  const receivedAt = own(value, "receivedAt");
  return {
    option: typeof option === "string" ? option : undefined,
    words: typeof words === "string" ? words : undefined,
    receivedAt: typeof receivedAt === "string" ? receivedAt : undefined,
  };
}

/** True for a head that is an owner answer: state and source both right. */
export function isReportedAnswer(head: HeadInfo): boolean {
  return (
    ANSWERED_STATES.includes(head.state) && head.source === REPORTED_SOURCE
  );
}

/**
 * True when the entry's time is on or after `since`. When `since` is `null`
 * (the flag was absent) every entry passes; when the time is absent the entry is
 * treated as too old to export, because a time this service could not read is not
 * one this session can sort.
 */
export function matchesSince(
  time: string | undefined,
  since: string | null,
): boolean {
  if (since === null) {
    return true;
  }
  if (time === undefined) {
    return false;
  }
  return time.slice(0, 10) >= since;
}

/**
 * Escapes a cell so a pipe or a newline cannot break the table: a backslash
 * becomes two, a pipe becomes an escaped pipe, and every line ending — `\r\n`,
 * `\r` or `\n` — becomes a space, so one decision is always one row.
 */
export function escapeCell(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r\n|\r|\n/g, " ");
}

/** Builds one markdown table row from the verdict, the words and the time. */
export function formatRow(
  head: HeadInfo,
  entry: EntryInfo | undefined,
): string {
  const verdict =
    entry?.option !== undefined
      ? `${head.state} (${entry.option})`
      : head.state;
  const words = entry?.words ?? "";
  const time = entry?.receivedAt ?? "";
  return [
    ANSWER_PREFIX,
    head.id,
    head.question,
    verdict,
    words,
    time,
    `revision ${head.revision}, textSha256 ${head.textSha256}`,
  ]
    .map(escapeCell)
    .join(" | ");
}

/**
 * The whole Markdown document: the heading, a header row and a separator, then
 * one row per decision — or `None.` when there are none.
 */
export function buildMarkdown(rows: readonly DecisionRecord[]): string {
  if (rows.length === 0) {
    return `${EXPORT_HEADING}\n\nNone.`;
  }
  const formatted = rows.map((r) => `| ${formatRow(r.head, r.entry)} |`);
  return `${EXPORT_HEADING}\n\n| ${TABLE_HEADER} |\n| ${TABLE_SEPARATOR} |${formatted.map((r) => `\n${r}`).join("")}`;
}

const EXPORT_HEADING = "## Reported answers (reported, not signed)";
const TABLE_HEADER = `${ANSWER_PREFIX} | decision | question | verdict | words | time | text`;
const TABLE_SEPARATOR = "--- | --- | --- | --- | --- | --- | ---";
