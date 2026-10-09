import { describe, expect, it } from "vitest";

import { drawableDecision } from "../../public/decision.js";
import { decisionModel } from "../../public/views/decision-model.js";
import { renderDecision } from "../../public/views/decision.js";

import {
  NOTICE_DECISIONS,
  type NoticeFixture,
} from "../../../contract/__tests__/fixtures/notice-decisions.js";
import { decisionBindingText } from "@hexagen-monaco/waves-contract";
import type {
  StoredEntry,
  StoredRevision,
} from "../../src/application/ports/notice-store.js";
import type { Head } from "../../src/application/notice-read-model.js";
import { HASH, headFromFixture, INBOX_NOW_MS, NOW_ISO } from "./fixtures.js";
import {
  assertNoInjectedMarkup,
  freshRoot,
  textOf,
  textsOf,
} from "./helpers.js";

/**
 * The fixture's revision, with the server's own hash and receive time added:
 * the server computes `textSha256` over the binding text with
 * `decisionBindingText`, and sets `receivedAt` to the revision's `raisedAt`.
 */
function storedFromFixture(
  revision: Record<string, unknown>,
  number: number,
): StoredRevision {
  const hash = decisionBindingText(revision as never);
  const raisedAt = String(
    (revision as { raisedAt?: string }).raisedAt ?? NOW_ISO,
  );
  return {
    revision: number,
    textSha256: hash,
    receivedAt: raisedAt,
    decision: revision,
  } as unknown as StoredRevision;
}

/** One state entry from the fixture, with the index the store assigns. */
function entryFromFixture(
  state: Record<string, unknown>,
  index: number,
  hashes: Map<number, string>,
): StoredEntry {
  const revision = Number(state.revision);
  return {
    index,
    receivedAt: String(state.at ?? NOW_ISO),
    state: state.state,
    source: state.source,
    revision,
    textSha256: hashes.get(revision) ?? HASH,
    by: state.by,
    at: state.at,
    ...(state.option !== undefined ? { option: state.option } : {}),
    ...(state.words !== undefined ? { words: state.words } : {}),
    ...(state.reason !== undefined ? { reason: state.reason } : {}),
    ...(state.supersededBy !== undefined
      ? { supersededBy: state.supersededBy }
      : {}),
  } as unknown as StoredEntry;
}

/**
 * The whole response `GET …/decisions/<id>` would give for a fixture, built the
 * same way the server does: each revision wrapped with the server's hash and
 * receive time, each state wrapped with an index, and the head computed from
 * them.
 */
function decisionFromFixture(fixture: NoticeFixture): {
  head: Head;
  revisions: unknown[];
  entries: unknown[];
} {
  const revisions = fixture.revisions.map((rev, i) =>
    storedFromFixture(rev as Record<string, unknown>, i + 1),
  );
  const hashes = new Map(
    revisions.map((r) => [r.revision, r.textSha256] as const),
  );
  const entries = fixture.states.map((state, i) =>
    entryFromFixture(state as Record<string, unknown>, i, hashes),
  );
  const currentRevision = revisions[revisions.length - 1]!;
  const currentHash = currentRevision.textSha256;
  const baseHead = headFromFixture(fixture, INBOX_NOW_MS);
  return {
    head: { ...baseHead, textSha256: currentHash },
    revisions,
    entries,
  };
}

/** Draw a fixture-built decision and assert the text has no junk words. */
function draw(fixture: NoticeFixture): HTMLElement {
  const view = decisionFromFixture(fixture);
  if (!drawableDecision(view, fixture.project, fixture.id)) {
    throw new Error("not a drawable decision");
  }
  const model = decisionModel(view);
  const host = freshRoot();
  host.append(renderDecision(model));
  assertNoInjectedMarkup();
  const text = host.textContent ?? "";
  for (const word of ["undefined", "null", "NaN", "Invalid Date"]) {
    expect(text).not.toContain(word);
  }
  return host;
}

function findFixture(id: string): NoticeFixture {
  const found = NOTICE_DECISIONS.find((f) => f.id === id);
  if (found === undefined) {
    throw new Error(`no fixture named ${id}`);
  }
  return found;
}

describe("the give-up-bound fixture", () => {
  const host = draw(findFixture("give-up-bound"));

  it("says Raised by on revision 1", () => {
    expect(textOf(host)).toContain("Raised by session");
  });

  it("says revision 2 changed options with the change note", () => {
    expect(textOf(host)).toContain(
      "Revision 2 on 2026-10-08 at 12:00 UTC: options changed. narrowed after the session reported a window.",
    );
  });

  it("shows the earlier entry as on an earlier text", () => {
    expect(textOf(host)).toContain(
      "fleet session decided under delegation: a (on an earlier text)",
    );
  });

  it("shows the current entry without the earlier-text mark", () => {
    const entries = textsOf(host, ".history-event").filter((e) =>
      e.includes("fleet session decided under delegation: a"),
    );
    expect(entries).toHaveLength(2);
    expect(entries.some((e) => e.includes("(on an earlier text)"))).toBe(true);
    expect(entries.some((e) => !e.includes("(on an earlier text)"))).toBe(true);
  });
});

describe("the test-db-switch-hold fixture", () => {
  const host = draw(findFixture("test-db-switch-hold"));

  it("says Raised by on revision 1", () => {
    expect(textOf(host)).toContain("Raised by session");
  });

  it("shows the answered entry with the option and words", () => {
    expect(textOf(host)).toContain(
      'fleet session recorded that you answered (hold) on 2026-10-08 at 13:00 UTC: "Not recorded in the fleet\'s summary" reported, not signed',
    );
  });

  it("shows the approved entry as the current state", () => {
    expect(textOf(host)).toContain(
      'fleet session recorded that you approved (lift) on 2026-10-08 at 13:00 UTC: "Not recorded in the fleet\'s summary" reported, not signed',
    );
  });

  it("does not mark the current-text answers as on an earlier text", () => {
    expect(textOf(host)).not.toContain(
      "Not recorded in the fleet's summary\" reported, not signed (on an earlier text)",
    );
  });
});
