import { describe, expect, it } from "vitest";

import {
  validateStoredStateEntry,
  type StoredStateEntry,
} from "../src/index.js";
import { errorsOf } from "./support.js";

const HASH = "0".repeat(64);
const NONCE = "A".repeat(43);

function minimalSignature(): Record<string, unknown> {
  return {
    credentialId: "A".repeat(16),
    authenticatorData: "B".repeat(49) + "A",
    clientDataJSON: "C".repeat(20),
    signature: "D".repeat(8),
    nonce: NONCE,
    index: 2,
  };
}

function minimalSigned(): Record<string, unknown> {
  return {
    state: "approved",
    source: "signed",
    revision: 1,
    textSha256: HASH,
    by: "owner",
    at: "2026-10-08T12:00:00Z",
    signature: minimalSignature(),
  };
}

function minimalEntry(): Record<string, unknown> {
  return {
    state: "approved",
    source: "reported",
    revision: 1,
    textSha256: HASH,
    by: "owner",
    at: "2026-10-08T12:00:00Z",
    words: "Go with option A",
  };
}

function expectValidEntry(input: unknown): StoredStateEntry {
  const result = validateStoredStateEntry(input);
  if (!result.ok) {
    throw new Error(
      `expected a valid stored entry, got ${JSON.stringify(result.errors)}`,
    );
  }
  return result.value;
}

function entryPaths(input: unknown, expected: readonly string[]): void {
  expect(errorsOf(validateStoredStateEntry(input)).map((e) => e.path)).toEqual(
    expected,
  );
}

describe("validateStoredStateEntry", () => {
  it("accepts a signed entry and keeps its signature", () => {
    const entry = expectValidEntry(minimalSigned());
    expect(entry.source).toBe("signed");
    expect(entry.signature).toEqual(minimalSignature());
  });

  it("accepts a signed declined entry and a signed answered entry", () => {
    expect(
      expectValidEntry({ ...minimalSigned(), state: "declined" }).state,
    ).toBe("declined");
    const answered = expectValidEntry({
      ...minimalSigned(),
      state: "answered",
      option: "b",
    });
    expect(answered.option).toBe("b");
  });

  it("accepts a reported answer, a session delegated and a session withdrawn entry", () => {
    expect(expectValidEntry(minimalEntry()).words).toBe("Go with option A");
    expect(
      expectValidEntry({
        ...minimalEntry(),
        state: "delegated",
        source: "session",
        option: "a",
      }).option,
    ).toBe("a");
    expect(
      expectValidEntry({
        ...minimalEntry(),
        state: "withdrawn",
        source: "session",
        reason: "fixed another way",
      }).reason,
    ).toBe("fixed another way");
    expect(
      expectValidEntry({
        ...minimalEntry(),
        state: "superseded",
        source: "session",
        supersededBy: "other-decision",
      }).supersededBy,
    ).toBe("other-decision");
  });

  it("refuses a non-object root and an input that is not serialisable", () => {
    entryPaths("entry", [""]);
    entryPaths({ ...minimalEntry(), big: 1n }, [""]);
  });

  it("refuses an unknown key and the request-only expectedEntries", () => {
    entryPaths({ ...minimalEntry(), extra: 1 }, ["/extra"]);
    entryPaths({ ...minimalEntry(), expectedEntries: 0 }, ["/expectedEntries"]);
  });

  it("refuses a state that is never written", () => {
    entryPaths({ ...minimalEntry(), state: "open" }, ["/state"]);
  });

  it("refuses a source outside session, reported and signed", () => {
    entryPaths({ ...minimalEntry(), source: "session answer" }, ["/source"]);
  });

  it("bounds revision, textSha256, by and at as a written entry does", () => {
    entryPaths({ ...minimalEntry(), revision: 0 }, ["/revision"]);
    entryPaths({ ...minimalEntry(), textSha256: "0".repeat(63) }, [
      "/textSha256",
    ]);
    entryPaths({ ...minimalEntry(), by: "b".repeat(81) }, ["/by"]);
    entryPaths({ ...minimalEntry(), at: "yesterday" }, ["/at"]);
    entryPaths({ ...minimalEntry(), by: 42 }, ["/by"]);
  });

  it("refuses words, option, reason and supersededBy out of their rules", () => {
    entryPaths({ ...minimalEntry(), words: " words" }, ["/words"]);
    entryPaths({ ...minimalEntry(), option: "B" }, ["/option"]);
    entryPaths({ ...minimalEntry(), reason: 7 }, ["/reason"]);
    entryPaths(
      {
        ...minimalEntry(),
        state: "superseded",
        source: "session",
        supersededBy: "bad id",
      },
      ["/supersededBy"],
    );
    entryPaths(
      {
        ...minimalEntry(),
        state: "superseded",
        source: "session",
        supersededBy: 42,
      },
      ["/supersededBy"],
    );
  });

  it("refuses a session or a reported answer with the wrong state", () => {
    entryPaths({ ...minimalEntry(), source: "session" }, ["/source"]);
    entryPaths({ ...minimalEntry(), state: "delegated", source: "reported" }, [
      "/source",
    ]);
  });

  it("refuses a reported answer without words", () => {
    const withoutWords = { ...minimalEntry() };
    delete (withoutWords as Record<string, unknown>).words;
    entryPaths(withoutWords, ["/words"]);
  });

  it("refuses a delegated state without option or words", () => {
    const withoutWords = {
      ...minimalEntry(),
      state: "delegated",
      source: "session",
    };
    delete (withoutWords as Record<string, unknown>).words;
    entryPaths(withoutWords, ["/option"]);
  });

  it("refuses a withdrawn state without a reason and a superseded state without supersededBy", () => {
    const withoutWords = {
      ...minimalEntry(),
      state: "withdrawn",
      source: "session",
    };
    delete (withoutWords as Record<string, unknown>).words;
    entryPaths(withoutWords, ["/reason"]);
    const superseded = {
      ...minimalEntry(),
      state: "superseded",
      source: "session",
    };
    delete (superseded as Record<string, unknown>).words;
    entryPaths(superseded, ["/supersededBy"]);
  });

  it("refuses supersededBy on a state that is not superseded", () => {
    entryPaths({ ...minimalEntry(), supersededBy: "other" }, ["/supersededBy"]);
  });

  it("a stored signed entry without a signature is refused", () => {
    const withoutSignature = { ...minimalSigned() };
    delete (withoutSignature as Record<string, unknown>).signature;
    entryPaths(withoutSignature, ["/signature"]);
    entryPaths({ ...minimalSigned(), signature: "D".repeat(8) }, [
      "/signature",
    ]);
  });

  it("a signature on a reported entry is refused", () => {
    entryPaths({ ...minimalEntry(), signature: minimalSignature() }, [
      "/signature",
    ]);
    entryPaths(
      {
        ...minimalEntry(),
        state: "delegated",
        source: "session",
        option: "a",
        signature: minimalSignature(),
      },
      ["/signature"],
    );
  });

  it("refuses a signature whose six fields break the answer request's bounds", () => {
    for (const [field, value] of [
      ["credentialId", "A".repeat(15)],
      ["authenticatorData", "B".repeat(49)],
      ["clientDataJSON", "C".repeat(19)],
      ["signature", "D".repeat(7)],
      ["nonce", "A".repeat(42)],
      ["index", -1],
    ] as const) {
      entryPaths(
        {
          ...minimalSigned(),
          signature: { ...minimalSignature(), [field]: value },
        },
        [`/signature/${field}`],
      );
    }
    entryPaths(
      {
        ...minimalSigned(),
        signature: { ...minimalSignature(), extra: "no" },
      },
      ["/signature/extra"],
    );
  });
});
