import { describe, expect, it } from "vitest";

import { MemoryStore } from "../src/index.js";
import { project, runStoreContract, snapshot } from "./store-contract.js";

runStoreContract(() => ({
  store: new MemoryStore(),
  dispose: () => Promise.resolve(),
}));

describe("MemoryStore", () => {
  it("does not hand out a reference to a stored project", async () => {
    const store = new MemoryStore();
    const alpha = project("alpha", "Alpha");
    await store.putProject(alpha);

    alpha.name = "mutated after the write";
    const read = await store.getProject("alpha");
    expect(read?.name).toBe("Alpha");

    if (read === undefined) {
      throw new Error("expected the project to be stored");
    }
    read.name = "mutated after the read";
    expect((await store.getProject("alpha"))?.name).toBe("Alpha");
  });

  it("does not hand out a reference to a stored snapshot", async () => {
    const store = new MemoryStore();
    const pushed = snapshot("wv1");
    await store.putSnapshot(pushed);

    pushed.receivedAt = "mutated after the write";
    const read = await store.getSnapshot("alpha", "wv1");
    expect(read?.receivedAt).toBe("2026-10-01T12:00:01Z");

    if (read === undefined) {
      throw new Error("expected the snapshot to be stored");
    }
    read.envelope.lanes.push({
      id: "lane-1",
      derived: { alive: true },
      disagreements: [],
    });
    expect((await store.getSnapshot("alpha", "wv1"))?.envelope.lanes).toEqual(
      [],
    );
  });

  it("does not hand out a reference to a listed project", async () => {
    const store = new MemoryStore();
    await store.putProject(project("alpha", "Alpha"));

    const listed = await store.listProjects();
    if (listed[0] === undefined) {
      throw new Error("expected the project to be listed");
    }
    listed[0].name = "mutated after listing";

    expect((await store.getProject("alpha"))?.name).toBe("Alpha");
  });
});
