import type {
  DecisionRevision,
  NoticeEvent,
  StateEntryRequest,
} from "@hexagen-monaco/waves-contract";

/**
 * One revision of a decision as the store holds it: the validated revision the
 * writer sent, the moment the server received it, and the server's own
 * `textSha256` over `decisionBindingText(revision)`, returned to the writer so
 * the next state entry can pin to it.
 */
export interface StoredRevision {
  readonly revision: number;
  readonly textSha256: string;
  readonly receivedAt: string;
  readonly decision: DecisionRevision;
}

/**
 * One state entry as the store holds it: the writer's request minus the
 * `expectedEntries` it pinned on, plus the index it took at append time and the
 * moment the server received it. The writer's own `revision` and `textSha256`
 * are kept on the entry so a reader never has to recompute them.
 */
export interface StoredEntry {
  readonly index: number;
  readonly receivedAt: string;
  readonly state: StateEntryRequest["state"];
  readonly source: StateEntryRequest["source"];
  readonly revision: number;
  readonly textSha256: string;
  readonly by: string;
  readonly at: string;
  readonly words?: string;
  readonly option?: string;
  readonly reason?: string;
  readonly supersededBy?: StateEntryRequest["supersededBy"];
}

/**
 * One decision as the store holds it: every revision and every state entry,
 * each append-only. `revisions[0]` is revision 1; `entries[i].index` is `i`.
 */
export interface StoredDecision {
  readonly project: string;
  readonly id: string;
  readonly revisions: StoredRevision[];
  readonly entries: StoredEntry[];
}

/**
 * One event as the store holds it: the validated event the writer sent, the
 * moment the server received it, and the id the server gave it.
 */
export interface StoredEvent {
  readonly id: string;
  readonly receivedAt: string;
  readonly event: NoticeEvent;
}

/**
 * The result of appending to a decision or an event list, serialised by the
 * store as one read-compare-write:
 * - `stored` — the write landed;
 * - `conflict` — the pin the writer sent did not match the current count;
 * - `missing` — the decision the entry names does not exist;
 * - `ceiling` — the project is already at its decision cap, on create only.
 */
export type AppendOutcome = "stored" | "conflict" | "missing" | "ceiling";

/**
 * The notice side of a project store. Each append is one operation the store
 * serialises (read, compare, write), which is what makes rule 2's "one 201, one
 * 409" true: two writers with the same `expectRevisions` or `expectEntries`
 * cannot both pass the compare. The writer fills `index` and `receivedAt` on the
 * entry and `revision` on the revision before it calls; the store applies them
 * only if the count it read matches the writer's expectation.
 */
export interface NoticeStorePort {
  getDecision(project: string, id: string): Promise<StoredDecision | undefined>;
  listDecisions(project: string): Promise<readonly StoredDecision[]>;
  /**
   * Appends revision `expectRevisions + 1` only when the decision holds exactly
   * `expectRevisions` revisions: 0 creates it. `ceiling` is the most decisions
   * a project may hold, applied only on create.
   */
  appendRevision(
    project: string,
    id: string,
    revision: StoredRevision,
    expectRevisions: number,
    ceiling: number,
  ): Promise<AppendOutcome>;
  /**
   * Appends an entry only when the decision holds exactly `expectEntries` entries
   * and `expectRevisions` revisions. A revision added since the writer read it
   * changes the count and is a conflict, so a text that moved between the read
   * and the write is refused with the current three (rule 2).
   */
  appendEntry(
    project: string,
    id: string,
    entry: StoredEntry,
    expectEntries: number,
    expectRevisions: number,
  ): Promise<AppendOutcome>;
  /**
   * Appends an event; when the project then holds more than `keep`, the oldest
   * are dropped. Answers how many were dropped.
   */
  appendEvent(
    project: string,
    stored: StoredEvent,
    keep: number,
  ): Promise<{ dropped: number }>;
  listEvents(project: string, limit: number): Promise<readonly StoredEvent[]>;
  /**
   * Removes every notice a project has: every decision and every event. A
   * project delete calls this too (design W60).
   */
  deleteNotices(project: string): Promise<void>;
}
