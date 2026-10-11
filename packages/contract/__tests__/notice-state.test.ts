import { describe, expect, it } from "vitest";

import { validateStateEntry, type StateEntryRequest } from "../src/index.js";
import { errorsOf } from "./support.js";

function minimalState(): Record<string, unknown> {
  return {
    state: "approved",
    source: "reported",
    revision: 1,
    textSha256: "0".repeat(64),
    expectedEntries: 0,
    by: "owner",
    at: "2026-10-08T12:00:00Z",
    words: "Go with option A",
  };
}

function expectValidState(input: unknown): StateEntryRequest {
  const result = validateStateEntry(input);
  if (!result.ok) {
    throw new Error(
      `expected valid state, got ${JSON.stringify(result.errors)}`,
    );
  }
  return result.value;
}

function expectStatePaths(input: unknown, expected: readonly string[]): void {
  const result = validateStateEntry(input);
  expect(errorsOf(result).map((e) => e.path)).toEqual(expected);
}

describe("validateStateEntry — valid states", () => {
  it("accepts a reported approved state", () => {
    expectValidState(minimalState());
  });

  it("accepts a reported declined state", () => {
    expectValidState({ ...minimalState(), state: "declined" });
  });

  it("accepts a reported answered state with an option", () => {
    expectValidState({
      ...minimalState(),
      state: "answered",
      option: "a",
      words: "I choose A",
    });
  });

  it("accepts a session delegated state with an option", () => {
    expectValidState({
      ...minimalState(),
      state: "delegated",
      source: "session",
      by: "project session",
      option: "a",
    });
  });

  it("accepts a session delegated state with words", () => {
    expectValidState({
      ...minimalState(),
      state: "delegated",
      source: "session",
      by: "project session",
      words: "fleet session decided",
    });
  });

  it("accepts a session withdrawn state with a reason", () => {
    expectValidState({
      ...minimalState(),
      state: "withdrawn",
      source: "session",
      by: "project session",
      reason: "fixed another way",
    });
  });

  it("accepts a session superseded state with supersededBy", () => {
    expectValidState({
      ...minimalState(),
      state: "superseded",
      source: "session",
      by: "project session",
      supersededBy: "other-decision",
    });
  });
});

describe("validateStateEntry — refusals", () => {
  it("rejects a non-object root", () => {
    expectStatePaths("hello", [""]);
  });

  it("requires known keys only", () => {
    expectStatePaths({ ...minimalState(), extra: true }, ["/extra"]);
  });

  it("a session cannot write a signed entry", () => {
    expect(
      errorsOf(validateStateEntry({ ...minimalState(), source: "signed" })),
    ).toEqual([
      { path: "/source", message: "expected one of session, reported" },
    ]);
    expectStatePaths(
      {
        ...minimalState(),
        source: "reported",
        signature: {
          credentialId: "A".repeat(16),
          authenticatorData: "B".repeat(50),
          clientDataJSON: "C".repeat(20),
          signature: "D".repeat(8),
          nonce: "A".repeat(43),
          index: 0,
        },
      },
      ["/signature"],
    );
  });

  it("rejects open as a written state", () => {
    expectStatePaths({ ...minimalState(), state: "open" }, ["/state"]);
  });

  it("rejects an integer below 1 for revision", () => {
    expectStatePaths({ ...minimalState(), revision: 0 }, ["/revision"]);
  });

  it("rejects a non-hex textSha256", () => {
    expectStatePaths({ ...minimalState(), textSha256: "not-a-hash" }, [
      "/textSha256",
    ]);
  });

  it("rejects an integer below 0 for expectedEntries", () => {
    expectStatePaths({ ...minimalState(), expectedEntries: -1 }, [
      "/expectedEntries",
    ]);
  });

  it("requires at least 80 chars for by", () => {
    expectStatePaths({ ...minimalState(), by: "b".repeat(81) }, ["/by"]);
  });

  it("rejects an answer state with source: session", () => {
    expectStatePaths(
      { ...minimalState(), state: "approved", source: "session" },
      ["/source"],
    );
  });

  it("rejects a reported answer without words", () => {
    const withoutWords = { ...minimalState() };
    delete (withoutWords as Record<string, unknown>).words;
    expectStatePaths(withoutWords, ["/words"]);
  });

  it("rejects a delegated state with source: reported", () => {
    expectStatePaths(
      { ...minimalState(), state: "delegated", source: "reported" },
      ["/source"],
    );
  });

  it("rejects a delegated state without option or words", () => {
    const withoutOption = {
      ...minimalState(),
      state: "delegated",
      source: "session",
    };
    delete (withoutOption as Record<string, unknown>).words;
    expectStatePaths(withoutOption, ["/option"]);
  });

  it("rejects a withdrawn state without a reason", () => {
    const withoutReason = {
      ...minimalState(),
      state: "withdrawn",
      source: "session",
    };
    delete (withoutReason as Record<string, unknown>).words;
    expectStatePaths(withoutReason, ["/reason"]);
  });

  it("rejects supersededBy on a non-superseded state", () => {
    expectStatePaths({ ...minimalState(), supersededBy: "other" }, [
      "/supersededBy",
    ]);
  });

  it("rejects a superseded state without supersededBy", () => {
    const withoutSupersededBy = {
      ...minimalState(),
      state: "superseded",
      source: "session",
    };
    delete (withoutSupersededBy as Record<string, unknown>).words;
    expectStatePaths(withoutSupersededBy, ["/supersededBy"]);
  });

  it("collects independent errors", () => {
    expectStatePaths(
      {
        ...minimalState(),
        source: "signed",
        revision: 0,
      },
      ["/source", "/revision"],
    );
  });

  it("requires a valid at timestamp", () => {
    expectStatePaths({ ...minimalState(), at: "yesterday" }, ["/at"]);
  });

  it("rejects an undefined root", () => {
    expectStatePaths(undefined, [""]);
  });

  it("rejects an invalid supersededBy", () => {
    expectStatePaths(
      {
        ...minimalState(),
        state: "superseded",
        source: "session",
        supersededBy: "bad id",
      },
      ["/supersededBy"],
    );
    expectStatePaths(
      {
        ...minimalState(),
        state: "superseded",
        source: "session",
        supersededBy: 42,
      },
      ["/supersededBy"],
    );
  });
});
