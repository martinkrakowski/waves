import { describe, expect, it } from "vitest";

import { validateEvent, type NoticeEvent } from "../src/index.js";
import { errorsOf } from "./support.js";

function minimalEvent(): Record<string, unknown> {
  return {
    schema: "waves-notice/v1",
    kind: "event",
    project: "alpha",
    topic: "relay",
    text: "Round 4 sent to five sessions",
    at: "2026-10-08T12:00:00Z",
  };
}

function expectValidEvent(input: unknown): NoticeEvent {
  const result = validateEvent(input);
  if (!result.ok) {
    throw new Error(
      `expected valid event, got ${JSON.stringify(result.errors)}`,
    );
  }
  return result.value;
}

function expectEventPaths(input: unknown, expected: readonly string[]): void {
  const result = validateEvent(input);
  expect(errorsOf(result).map((e) => e.path)).toEqual(expected);
}

describe("validateEvent", () => {
  it("accepts a valid event", () => {
    expectValidEvent(minimalEvent());
  });

  it("accepts an event with optional fields", () => {
    expectValidEvent({
      ...minimalEvent(),
      detail: "Extra context",
      refs: { pr: 42 },
    });
  });

  it("rejects a non-object root", () => {
    expectEventPaths("hello", [""]);
  });

  it("rejects an unknown key", () => {
    expectEventPaths({ ...minimalEvent(), extra: true }, ["/extra"]);
  });

  it("requires the waves-notice/v1 schema", () => {
    expectEventPaths({ ...minimalEvent(), schema: "waves/v1" }, ["/schema"]);
  });

  it("requires kind to be event", () => {
    expectEventPaths({ ...minimalEvent(), kind: "decision" }, ["/kind"]);
  });

  it("requires a project id", () => {
    expectEventPaths({ ...minimalEvent(), project: "Alpha" }, ["/project"]);
  });

  it("requires a valid topic", () => {
    expectEventPaths({ ...minimalEvent(), topic: "Relay" }, ["/topic"]);
    expectEventPaths({ ...minimalEvent(), topic: "a".repeat(33) }, ["/topic"]);
  });

  it("requires text of 1 to 300 characters", () => {
    expectValidEvent({ ...minimalEvent(), text: "a".repeat(300) });
    expectEventPaths({ ...minimalEvent(), text: "" }, ["/text"]);
    expectEventPaths({ ...minimalEvent(), text: "a".repeat(301) }, ["/text"]);
  });

  it("requires detail to be valid text when present", () => {
    expectValidEvent({ ...minimalEvent(), detail: "d".repeat(2000) });
    expectEventPaths({ ...minimalEvent(), detail: "d".repeat(2001) }, [
      "/detail",
    ]);
    expectEventPaths({ ...minimalEvent(), detail: "trailing " }, ["/detail"]);
  });

  it("requires a valid at timestamp", () => {
    expectEventPaths({ ...minimalEvent(), at: "yesterday" }, ["/at"]);
  });

  it("closes the refs object", () => {
    expectEventPaths({ ...minimalEvent(), refs: { extra: true } }, [
      "/refs/extra",
    ]);
  });

  it("requires refs.pr to be an integer of at least 1", () => {
    expectEventPaths({ ...minimalEvent(), refs: { pr: 0 } }, ["/refs/pr"]);
  });

  it("rejects a null optional", () => {
    expectEventPaths({ ...minimalEvent(), refs: null }, ["/refs"]);
  });

  it("rejects a non-NFC text", () => {
    expectEventPaths({ ...minimalEvent(), text: "cafe\u0301" }, ["/text"]);
  });

  it("rejects an undefined root", () => {
    expectEventPaths(undefined, [""]);
  });
});
