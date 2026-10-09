import { describe, expect, it } from "vitest";

import { isNoteName } from "../src/infrastructure/note-names.js";
import { mayWriteNote } from "../src/infrastructure/note-store.js";

describe("notes", () => {
  it("refuses a name that climbs out of the notes directory", () => {
    expect(isNoteName("../x")).toBe(false);
  });

  it("lets only the project's own token write its note", () => {
    const tokens = new Map([
      ["alpha", "alpha-token"],
      ["beta", "beta-token"],
    ]);
    expect(mayWriteNote("alpha-token", tokens)).toBe(true);
  });
});
