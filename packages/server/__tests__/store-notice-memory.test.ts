import { describe, expect, it } from "vitest";

import { MemoryStore } from "../src/index.js";
import { storedEntry, storedRevision } from "./notice-contract.js";

const PROJECT = "alpha";

function store() {
  return new MemoryStore();
}

describe("MemoryStore notice methods", () => {
  it("lists a project's decisions ordered by id", async () => {
    const s = store();
    await s.appendRevision(PROJECT, "z", storedRevision(1), 0, 3);
    await s.appendRevision(PROJECT, "a", storedRevision(1), 0, 3);

    expect((await s.listDecisions(PROJECT)).map((d) => d.id)).toEqual([
      "a",
      "z",
    ]);
    expect(await s.listDecisions("absent")).toEqual([]);
  });

  it("answers missing when the project has no decision on appendEntry", async () => {
    const s = store();
    expect(await s.appendEntry(PROJECT, "d1", storedEntry(0), 0)).toBe(
      "missing",
    );
  });

  it("answers missing when the decision is absent on appendEntry", async () => {
    const s = store();
    await s.appendRevision(PROJECT, "other", storedRevision(1), 0, 3);
    expect(await s.appendEntry(PROJECT, "d1", storedEntry(0), 0)).toBe(
      "missing",
    );
  });

  it("answers conflict when the revision count is stale on appendRevision", async () => {
    const s = store();
    await s.appendRevision(PROJECT, "d1", storedRevision(1), 0, 3);
    expect(await s.appendRevision(PROJECT, "d1", storedRevision(2), 5, 3)).toBe(
      "conflict",
    );
  });
});
