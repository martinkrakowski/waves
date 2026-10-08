import type {
  DecisionRevision,
  NoticeEvent,
} from "@hexagen-monaco/waves-contract";

import type {
  AppendOutcome,
  NoticeStorePort,
  StoredEntry,
  StoredRevision,
} from "../src/application/ports/notice-store.js";

const HASH = "0".repeat(64);

export interface NoticeHarness {
  readonly store: NoticeStorePort;
  readonly dispose: () => Promise<void>;
}

/** A valid choice decision revision, overridable for the test. */
export function decisionRevision(
  id: string,
  project = "alpha",
  overrides: Partial<DecisionRevision> = {},
): DecisionRevision {
  return {
    schema: "waves-notice/v1",
    kind: "decision",
    project,
    id,
    shape: "choice",
    question: "Ship it?",
    options: [
      { key: "a", text: "Yes", cost: "a" },
      { key: "b", text: "No", cost: "b" },
    ],
    hardToUndo: { value: false, reason: "a message text" },
    commits: [],
    decider: "owner",
    appliesTo: [],
    evidence: [],
    raisedBy: "session",
    raisedAt: "2026-10-08T12:00:00Z",
    ...overrides,
  };
}

export function storedRevision(
  revision: number,
  decision: DecisionRevision = decisionRevision("d1"),
): StoredRevision {
  return {
    revision,
    textSha256: HASH,
    receivedAt: "2026-10-08T12:00:00Z",
    decision,
  };
}

export function entryFields(
  overrides: Partial<StoredEntry> = {},
): Omit<StoredEntry, "index" | "receivedAt"> {
  return {
    state: "approved",
    source: "reported",
    revision: 1,
    textSha256: HASH,
    by: "owner",
    at: "2026-10-08T13:00:00Z",
    words: "ship it",
    ...overrides,
  };
}

export function storedEntry(
  index: number,
  overrides: Partial<StoredEntry> = {},
): StoredEntry {
  return {
    ...entryFields(overrides),
    index,
    receivedAt: "2026-10-08T13:00:00Z",
  };
}

export function event(overrides: Partial<NoticeEvent> = {}): NoticeEvent {
  return {
    schema: "waves-notice/v1",
    kind: "event",
    project: "alpha",
    topic: "relay",
    text: "Round 3 sent to five sessions",
    at: "2026-10-08T13:00:00Z",
    ...overrides,
  };
}

export type { AppendOutcome, NoticeStorePort, StoredEntry, StoredRevision };
