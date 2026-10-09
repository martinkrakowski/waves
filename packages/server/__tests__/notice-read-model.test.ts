import { describe, expect, it } from "vitest";

import { createNoticeReadModel } from "../src/application/notice-read-model.js";
import type { NoticeStorePort } from "../src/application/ports/notice-store.js";
import { MemoryStore } from "../src/infrastructure/memory-store.js";
import {
  decisionRevision,
  storedEntry,
  storedRevision,
} from "./notice-contract.js";

const NOW = Date.parse("2026-10-20T00:00:00Z");
const RECENT = "2026-10-19T00:00:00.000Z";
const OLD = "2026-10-01T00:00:00.000Z";

async function harness() {
  const store = new MemoryStore();
  await store.putProject({
    id: "alpha",
    name: "Alpha",
    tokenSha256: "0".repeat(64),
    registeredAt: "2026-10-01T00:00:00Z",
  });
  const model = createNoticeReadModel({
    store,
    noticeStore: store,
    now: () => NOW,
  });
  return { store, model };
}

describe("the notice read model", () => {
  it("counts a decision whose answer has aged out in no group", async () => {
    const { store, model } = await harness();
    await store.appendRevision("alpha", "old", storedRevision(1), 0, 10);
    await store.appendEntry("alpha", "old", storedEntry(0, {}, OLD), 0, 1);
    await store.appendRevision("alpha", "new", storedRevision(1), 0, 10);

    expect(await model.counts("alpha")).toEqual({
      waiting: 1,
      oneWay: 0,
      reported: 0,
      closed: 0,
    });
    const heads = await model.decisions("alpha");
    expect(heads.map((head) => [head.id, head.group])).toEqual([
      ["new", "waiting"],
      ["old", "history"],
    ]);
  });

  it("shows a covered answer with only the fields its entry holds", async () => {
    const { store, model } = await harness();
    await store.appendRevision("alpha", "d1", storedRevision(1), 0, 10);
    await store.appendEntry(
      "alpha",
      "d1",
      storedEntry(0, { words: undefined, option: "a" }, RECENT),
      0,
      1,
    );
    await store.appendEntry(
      "alpha",
      "d1",
      storedEntry(
        1,
        {
          state: "withdrawn",
          source: "session",
          words: undefined,
          reason: "gone",
        },
        RECENT,
      ),
      1,
      1,
    );

    const [head] = await model.decisions("alpha");
    expect(head?.group).toBe("closed");
    expect(head?.coveredAnswer).toEqual({
      state: "approved",
      source: "reported",
      at: RECENT,
      by: "owner",
      option: "a",
    });
  });

  it("orders heads of one group and one door by their time, oldest first", async () => {
    const { store, model } = await harness();
    const later = { ...storedRevision(1), receivedAt: "2026-10-09T00:00:00Z" };
    const earlier = {
      ...storedRevision(1),
      receivedAt: "2026-10-08T00:00:00Z",
    };
    await store.appendRevision("alpha", "a-later", later, 0, 10);
    await store.appendRevision("alpha", "b-earlier", earlier, 0, 10);
    await store.appendRevision("alpha", "c-earlier", earlier, 0, 10);
    await store.appendRevision(
      "alpha",
      "d-door",
      storedRevision(
        1,
        decisionRevision("d-door", "alpha", {
          hardToUndo: { value: true, reason: "cannot be undone" },
        }),
      ),
      0,
      10,
    );

    const heads = await model.decisions("alpha");
    expect(heads.map((head) => head.id)).toEqual([
      "d-door",
      "b-earlier",
      "c-earlier",
      "a-later",
    ]);
  });

  it("answers empty counts and heads for a project that is not registered", async () => {
    const { store, model } = await harness();
    await store.appendRevision("alpha", "d1", storedRevision(1), 0, 10);

    expect(await model.counts("absent")).toEqual({
      waiting: 0,
      oneWay: 0,
      reported: 0,
      closed: 0,
    });
    expect(await model.decisions("absent")).toEqual([]);
    const view = await model.decisionsView("absent");
    expect(view.counts).toEqual({
      waiting: 0,
      oneWay: 0,
      reported: 0,
      closed: 0,
    });
    expect(view.decisions).toEqual([]);
  });
});

describe("single pass over notice listings", () => {
  function counting(base: NoticeStorePort) {
    let calls = 0;
    const store: NoticeStorePort = {
      getDecision: (project, id) => base.getDecision(project, id),
      listDecisions: (project) => {
        calls += 1;
        return base.listDecisions(project);
      },
      appendRevision: (project, id, revision, expectRevisions, ceiling) =>
        base.appendRevision(project, id, revision, expectRevisions, ceiling),
      appendEntry: (project, id, entry, expectEntries, expectRevisions) =>
        base.appendEntry(project, id, entry, expectEntries, expectRevisions),
      appendEvent: (project, stored, keep) =>
        base.appendEvent(project, stored, keep),
      listEvents: (project, limit) => base.listEvents(project, limit),
      deleteNotices: (project) => base.deleteNotices(project),
    };
    return { store, calls: () => calls };
  }

  async function seeded() {
    const base = new MemoryStore();
    for (const id of ["a", "b", "c"]) {
      await base.putProject({
        id,
        name: id,
        tokenSha256: "0".repeat(64),
        registeredAt: "2026-10-01T00:00:00Z",
      });
      await base.appendRevision(id, "d", storedRevision(1), 0, 10);
    }
    const { store: noticeStore, calls } = counting(base);
    const model = createNoticeReadModel({
      store: base,
      noticeStore,
      now: () => NOW,
    });
    return { model, calls };
  }

  it("inbox() lists each project's decisions once", async () => {
    const { model, calls } = await seeded();
    await model.inbox();
    expect(calls()).toBe(3);
  });

  it("decisions(project) lists each project at most once", async () => {
    const { model, calls } = await seeded();
    await model.decisions("a");
    expect(calls()).toBe(3);
  });
});
