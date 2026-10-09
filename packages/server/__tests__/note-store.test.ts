import { describe, expect, it } from "vitest";

import { mayWriteNote } from "../src/infrastructure/note-store.js";

describe("mayWriteNote", () => {
  it("refuses a request that carries no token", () => {
    expect(mayWriteNote("right", "right", 10, "short")).toBe(true);
  });

  it("refuses a body over the cap", () => {
    expect(mayWriteNote("right", "right", 4, "too long")).toBe(false);
  });
});
