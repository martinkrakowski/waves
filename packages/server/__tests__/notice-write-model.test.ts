import { describe, expect, it } from "vitest";

import {
  decisionBindingText,
  MAX_DECISIONS_PER_PROJECT,
  MAX_REVISIONS_PER_DECISION,
  MAX_SESSION_ENTRIES_PER_DECISION,
  type StateEntryRequest,
} from "@hexagen-monaco/waves-contract";

import { MemoryStore } from "../src/index.js";
import type { NoticeStorePort } from "../src/application/ports/notice-store.js";
import { createNoticeWriteModel } from "../src/application/notice-write-model.js";
import { sha256Hex } from "../src/infrastructure/sha256.js";
import {
  decisionRevision,
  event,
  stateEntryRequest,
  storedRevision,
} from "./notice-contract.js";

const NOW_MS = Date.parse("2026-10-08T12:00:00Z");
const RECEIVED = new Date(NOW_MS).toISOString();
const PROJECT = "alpha";
const ID = "d1";
const BODY = decisionRevision(ID, PROJECT);
const BINDING_HASH = sha256Hex(decisionBindingText(BODY));

function model(store = new MemoryStore()) {
  return createNoticeWriteModel({
    noticeStore: store,
    now: () => NOW_MS,
    hashText: sha256Hex,
  });
}

/** A state-entry request pinned to revision 1's hash and the given entry count. */
function stateEntry(overrides: Partial<StateEntryRequest> = {}) {
  return stateEntryRequest({ textSha256: BINDING_HASH, ...overrides });
}

describe("raiseDecision", () => {
  it("creates revision 1 and returns its hash and an entry count of 0", async () => {
    const store = new MemoryStore();
    const m = model(store);
    const result = await m.raiseDecision(PROJECT, ID, BODY);
    expect(result).toEqual({
      kind: "stored",
      revision: 1,
      textSha256: BINDING_HASH,
      created: true,
      entries: 0,
    });
    expect(
      (await store.getDecision(PROJECT, ID))?.revisions[0]?.textSha256,
    ).toBe(BINDING_HASH);
  });

  it("refuses an invalid body with the contract's issues", async () => {
    expect(
      (await model().raiseDecision(PROJECT, ID, { schema: "x" })).kind,
    ).toBe("invalid");
  });

  it("refuses a body whose project or id is not the path's", async () => {
    const m = model();
    expect(
      await m.raiseDecision(PROJECT, ID, decisionRevision(ID, "beta")),
    ).toEqual({
      kind: "invalid",
      errors: [
        { path: "/project", message: "expected the project the path names" },
      ],
    });
    expect(
      await m.raiseDecision(PROJECT, ID, decisionRevision("other", PROJECT)),
    ).toEqual({
      kind: "invalid",
      errors: [{ path: "/id", message: "expected the id the path names" }],
    });
  });

  it("answers created:false and writes no revision when a PUT is identical", async () => {
    const store = new MemoryStore();
    const m = model(store);
    await m.raiseDecision(PROJECT, ID, BODY);

    expect(
      await m.raiseDecision(PROJECT, ID, decisionRevision(ID, PROJECT)),
    ).toEqual({
      kind: "stored",
      revision: 1,
      textSha256: BINDING_HASH,
      created: false,
      entries: 0,
    });
    expect((await store.getDecision(PROJECT, ID))?.revisions).toHaveLength(1);
  });

  it("makes revision 2 with the SAME hash when only evidence changes", async () => {
    const m = model();
    await m.raiseDecision(PROJECT, ID, BODY);
    expect(
      await m.raiseDecision(
        PROJECT,
        ID,
        decisionRevision(ID, PROJECT, {
          evidence: [{ label: "PR 7", href: "https://example.com/7" }],
        }),
      ),
    ).toEqual({
      kind: "stored",
      revision: 2,
      textSha256: BINDING_HASH,
      created: true,
      entries: 0,
    });
  });

  it("makes a revision with a different hash when the question changes", async () => {
    const m = model();
    await m.raiseDecision(PROJECT, ID, BODY);
    const changed = decisionRevision(ID, PROJECT, {
      question: "New question?",
    });
    expect(await m.raiseDecision(PROJECT, ID, changed)).toEqual({
      kind: "stored",
      revision: 2,
      textSha256: sha256Hex(decisionBindingText(changed)),
      created: true,
      entries: 0,
    });
  });

  it("refuses past the per-decision revision cap, naming it", async () => {
    const m = model();
    await m.raiseDecision(PROJECT, ID, BODY);
    for (let r = 2; r <= MAX_REVISIONS_PER_DECISION; r += 1) {
      await m.raiseDecision(
        PROJECT,
        ID,
        decisionRevision(ID, PROJECT, { question: `q${r}` }),
      );
    }
    expect(
      (
        await m.raiseDecision(
          PROJECT,
          ID,
          decisionRevision(ID, PROJECT, { question: "one more" }),
        )
      ).kind,
    ).toBe("tooManyRevisions");
  });

  it("refuses the create past the per-project decision ceiling", async () => {
    const m = model();
    for (let at = 0; at < MAX_DECISIONS_PER_PROJECT; at += 1) {
      await m.raiseDecision(
        PROJECT,
        `d${at}`,
        decisionRevision(`d${at}`, PROJECT),
      );
    }
    expect(
      (
        await m.raiseDecision(
          PROJECT,
          "over",
          decisionRevision("over", PROJECT),
        )
      ).kind,
    ).toBe("ceiling");
  });

  it("lets one of two concurrent creates win, the other a conflict", async () => {
    const m = model();
    const [a, b] = await Promise.all([
      m.raiseDecision(PROJECT, ID, BODY),
      m.raiseDecision(PROJECT, ID, BODY),
    ]);
    expect([a.kind, b.kind].sort()).toEqual(["conflict", "stored"]);
  });

  it("lets one of two concurrent updates win, the other a conflict", async () => {
    const m = model();
    await m.raiseDecision(PROJECT, ID, BODY);
    const [a, b] = await Promise.all([
      m.raiseDecision(
        PROJECT,
        ID,
        decisionRevision(ID, PROJECT, { question: "A" }),
      ),
      m.raiseDecision(
        PROJECT,
        ID,
        decisionRevision(ID, PROJECT, { question: "B" }),
      ),
    ]);
    expect([a.kind, b.kind].sort()).toEqual(["conflict", "stored"]);
  });
});

describe("postState", () => {
  const seed = async () => {
    const m = model();
    await m.raiseDecision(PROJECT, ID, BODY);
    return m;
  };

  it("returns notFound for a decision that does not exist", async () => {
    expect(await model().postState(PROJECT, "absent", stateEntry())).toEqual({
      kind: "notFound",
    });
  });

  it("appends a state entry and returns its index", async () => {
    const m = await seed();
    expect(
      await m.postState(PROJECT, ID, stateEntry({ expectedEntries: 0 })),
    ).toEqual({
      kind: "posted",
      index: 0,
    });
  });

  it("refuses rule 1: an answer state sent by a session is invalid", async () => {
    const m = await seed();
    expect(
      await m.postState(
        PROJECT,
        ID,
        stateEntry({
          state: "approved",
          source: "session",
          expectedEntries: 0,
        }),
      ),
    ).toMatchObject({ kind: "invalid" });
  });

  it.each([
    ["a stale revision", { revision: 2 }],
    ["a stale textSha256", { textSha256: "1".repeat(64) }],
    ["a stale expectedEntries", { expectedEntries: 5 }],
  ])("reports %s as a 409 with the current trio", async (_label, bad) => {
    const m = await seed();
    expect(await m.postState(PROJECT, ID, stateEntry(bad))).toEqual({
      kind: "conflict",
      error: "the state entry is out of date",
      revision: 1,
      textSha256: BINDING_HASH,
      entries: 0,
    });
  });

  it("pins before field validation: a stale count is a 409 over an invalid option", async () => {
    const m = await seed();
    expect(
      await m.postState(
        PROJECT,
        ID,
        stateEntry({ expectedEntries: 5, option: "z" }),
      ),
    ).toEqual({
      kind: "conflict",
      error: "the state entry is out of date",
      revision: 1,
      textSha256: BINDING_HASH,
      entries: 0,
    });
  });

  it("lets one of two posts with the same expectedEntries win, the other a 409", async () => {
    const m = await seed();
    const [a, b] = await Promise.all([
      m.postState(PROJECT, ID, stateEntry({ expectedEntries: 0 })),
      m.postState(PROJECT, ID, stateEntry({ expectedEntries: 0 })),
    ]);
    expect([a.kind, b.kind].sort()).toEqual(["conflict", "posted"]);
    if (a.kind === "posted") expect(a.index).toBe(0);
    if (b.kind === "posted") expect(b.index).toBe(0);
  });

  it("refuses an option that is not a key of the current revision", async () => {
    const m = await seed();
    expect(
      await m.postState(
        PROJECT,
        ID,
        stateEntry({ option: "z", expectedEntries: 0 }),
      ),
    ).toEqual({
      kind: "invalid",
      errors: [
        {
          path: "/option",
          message: "expected an option key of the current revision",
        },
      ],
    });
  });

  it("refuses a supersededBy that is not another decision of the project", async () => {
    const m = await seed();
    expect(
      await m.postState(
        PROJECT,
        ID,
        stateEntry({
          state: "superseded",
          source: "session",
          supersededBy: "missing",
          expectedEntries: 0,
        }),
      ),
    ).toEqual({
      kind: "invalid",
      errors: [
        {
          path: "/supersededBy",
          message: "expected another existing decision of this project",
        },
      ],
    });
  });

  it("accepts an option that is a key of the current revision", async () => {
    const m = await seed();
    expect(
      await m.postState(
        PROJECT,
        ID,
        stateEntry({ option: "a", expectedEntries: 0 }),
      ),
    ).toEqual({ kind: "posted", index: 0 });
  });

  it("accepts a supersededBy that is another decision of the project", async () => {
    const m = model();
    await m.raiseDecision(PROJECT, ID, BODY);
    await m.raiseDecision(PROJECT, "d2", decisionRevision("d2", PROJECT));
    expect(
      await m.postState(
        PROJECT,
        ID,
        stateEntry({
          state: "superseded",
          source: "session",
          supersededBy: "d2",
          expectedEntries: 0,
        }),
      ),
    ).toEqual({ kind: "posted", index: 0 });
  });

  it("refuses a supersededBy that is the decision itself", async () => {
    const m = await seed();
    expect(
      await m.postState(
        PROJECT,
        ID,
        stateEntry({
          state: "superseded",
          source: "session",
          supersededBy: ID,
          expectedEntries: 0,
        }),
      ),
    ).toEqual({
      kind: "invalid",
      errors: [
        {
          path: "/supersededBy",
          message: "expected another existing decision of this project",
        },
      ],
    });
  });

  it("returns notFound if the decision vanishes between the read and the append", async () => {
    // A store whose getDecision still finds the decision but whose
    // appendEntry reports it missing — the admin delete raced the write.
    const stub: NoticeStorePort = {
      getDecision: () =>
        Promise.resolve({
          project: PROJECT,
          id: ID,
          revisions: [
            {
              revision: 1,
              textSha256: BINDING_HASH,
              receivedAt: RECEIVED,
              decision: BODY,
            },
          ],
          entries: [],
        }),
      listDecisions: () => Promise.resolve([]),
      appendRevision: () => Promise.resolve("stored"),
      appendEntry: () => Promise.resolve("missing"),
      appendEvent: () => Promise.resolve({ id: "e0", dropped: 0 }),
      listEvents: () => Promise.resolve([]),
      deleteNotices: () => Promise.resolve(),
    };
    const m = createNoticeWriteModel({
      noticeStore: stub,
      now: () => NOW_MS,
      hashText: sha256Hex,
    });

    expect(await m.postState(PROJECT, ID, stateEntry())).toEqual({
      kind: "notFound",
    });
  });

  it("reports a revision that lands between the read and the append as a 409", async () => {
    const real = new MemoryStore();
    await createNoticeWriteModel({
      noticeStore: real,
      now: () => NOW_MS,
      hashText: sha256Hex,
    }).raiseDecision(PROJECT, ID, BODY);
    // A store whose appendEntry first slips a second revision in: the text the
    // model pinned on its read is no longer current, and the store's own
    // revision-count check must refuse it.
    const gained = storedRevision(
      2,
      decisionRevision(ID, PROJECT, { question: "Other?" }),
    );
    const stub: NoticeStorePort = {
      getDecision: (p, i) => real.getDecision(p, i),
      listDecisions: (p) => real.listDecisions(p),
      appendRevision: (p, i, r, e, c) => real.appendRevision(p, i, r, e, c),
      appendEntry: async (p, i, entry, expectEntries, expectRevisions) => {
        await real.appendRevision(
          p,
          i,
          gained,
          expectRevisions,
          MAX_DECISIONS_PER_PROJECT,
        );
        return real.appendEntry(p, i, entry, expectEntries, expectRevisions);
      },
      appendEvent: (p, s, keep) => real.appendEvent(p, s, keep),
      listEvents: (p, limit) => real.listEvents(p, limit),
      deleteNotices: (p) => real.deleteNotices(p),
    };
    const racing = createNoticeWriteModel({
      noticeStore: stub,
      now: () => NOW_MS,
      hashText: sha256Hex,
    });

    expect(
      await racing.postState(PROJECT, ID, stateEntry({ expectedEntries: 0 })),
    ).toEqual({
      kind: "conflict",
      error: "the state entry is out of date",
      revision: 1,
      textSha256: BINDING_HASH,
      entries: 0,
    });
  });

  it("refuses past the session-entry cap, naming it", async () => {
    const m = model();
    await m.raiseDecision(
      PROJECT,
      "capped",
      decisionRevision("capped", PROJECT),
    );
    for (let at = 0; at < MAX_SESSION_ENTRIES_PER_DECISION; at += 1) {
      await m.postState(PROJECT, "capped", stateEntry({ expectedEntries: at }));
    }
    expect(
      (
        await m.postState(
          PROJECT,
          "capped",
          stateEntry({ expectedEntries: MAX_SESSION_ENTRIES_PER_DECISION }),
        )
      ).kind,
    ).toBe("conflict");
  });
});

describe("postEvent", () => {
  it("stores the event and returns its id and dropped count", async () => {
    const store = new MemoryStore();
    const m = model(store);
    expect(await m.postEvent(PROJECT, event())).toEqual({
      kind: "posted",
      id: `${RECEIVED}-1`,
      dropped: 0,
    });
    expect(
      (await store.listEvents(PROJECT, 100)).map((e) => e.event),
    ).toHaveLength(1);
  });

  it("lists events newest first", async () => {
    const store = new MemoryStore();
    const m = model(store);
    for (const text of ["e0", "e1", "e2"]) {
      await m.postEvent(PROJECT, event({ text }));
    }
    expect(
      (await store.listEvents(PROJECT, 100)).map((e) => e.event.text),
    ).toEqual(["e2", "e1", "e0"]);
  });

  it("refuses an event whose project is not the path's", async () => {
    expect(
      await model().postEvent(PROJECT, event({ project: "beta" })),
    ).toEqual({
      kind: "invalid",
      errors: [
        { path: "/project", message: "expected the project the path names" },
      ],
    });
  });

  it("refuses an invalid event body", async () => {
    expect((await model().postEvent(PROJECT, { schema: "x" })).kind).toBe(
      "invalid",
    );
  });
});
