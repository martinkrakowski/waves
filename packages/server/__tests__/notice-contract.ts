import type {
  DecisionRevision,
  NoticeEvent,
  StateEntryRequest,
} from "@hexagen-monaco/waves-contract";

import type {
  NoticeStorePort,
  StoredEntry,
  StoredRevision,
} from "../src/application/ports/notice-store.js";

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
    question: "Question?",
    options: [
      { key: "a", text: "Yes", cost: "C1" },
      { key: "b", text: "No", cost: "C2" },
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
    textSha256: "0".repeat(64),
    receivedAt: "2026-10-08T12:00:00Z",
    decision,
  };
}

/**
 * A state-entry request as a writer posts it: the pin fields plus
 * `expectedEntries`, and no `index` or `receivedAt`, which the server fills.
 */
export function stateEntryRequest(
  overrides: Partial<StateEntryRequest> = {},
): StateEntryRequest {
  return {
    state: "approved",
    source: "reported",
    revision: 1,
    textSha256: "0".repeat(64),
    expectedEntries: 0,
    by: "owner",
    at: "2026-10-08T13:00:00Z",
    words: "ship it",
    ...overrides,
  };
}

/** A state entry as the store holds and appends it, with `expectedEntries`
 * dropped and the server's own `index` and `receivedAt` filled in. */
export function storedEntry(
  index: number,
  overrides: Partial<StateEntryRequest> = {},
  receivedAt = "2026-10-08T13:00:00Z",
): StoredEntry {
  const { expectedEntries: _dropped, ...rest } = stateEntryRequest(overrides);
  void _dropped;
  return { ...rest, index, receivedAt };
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
