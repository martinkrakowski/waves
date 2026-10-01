import { describe, expect, it } from "vitest";

import {
  BELL,
  expectEnvelopePaths,
  expectValidEnvelope,
  oneLane,
} from "./support.js";

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function detailOfBytes(total: number): Record<string, unknown> {
  let note = "x".repeat(total);
  while (serializedBytes({ note }) > total) {
    note = note.slice(0, -1);
  }
  while (serializedBytes({ note }) < total) {
    note = `${note}x`;
  }
  return { note };
}

function withDetail(detail: unknown): Record<string, unknown> {
  return oneLane({
    reported: {
      stage: "build",
      event: "started",
      ts: "2026-10-01T11:00:00Z",
      detail,
    },
  });
}

function nestedDetail(levels: number): Record<string, unknown> {
  let detail: Record<string, unknown> = { leaf: true };
  for (let level = 1; level < levels; level += 1) {
    detail = { [`level-${level}`]: detail };
  }
  return detail;
}

function nestedArray(levels: number): unknown {
  let value: unknown = { leaf: true };
  for (let level = 0; level < levels; level += 1) {
    value = [value];
  }
  return value;
}

describe("validateEnvelope detail keys", () => {
  it("accepts a detail of scalars, arrays and nested objects", () => {
    const detail = {
      counts: [1, 2, 3],
      nested: { ok: true, missing: null },
      note: "line one\nline two\tindented",
    };
    expect(
      expectValidEnvelope(withDetail(detail)).lanes[0]?.reported?.detail,
    ).toEqual(detail);
  });

  it("rejects a __proto__ key", () => {
    const detail = JSON.parse('{"__proto__":{"polluted":true}}') as unknown;

    expectEnvelopePaths(withDetail(detail), ["/lanes/0/reported/detail"]);
  });

  it("rejects a constructor key", () => {
    expectEnvelopePaths(withDetail({ constructor: "Object" }), [
      "/lanes/0/reported/detail",
    ]);
  });

  it("rejects a prototype key", () => {
    expectEnvelopePaths(withDetail({ prototype: {} }), [
      "/lanes/0/reported/detail",
    ]);
  });

  it("rejects a key with a control character", () => {
    const detail = { [`note${BELL}`]: 1 };

    expectEnvelopePaths(withDetail(detail), ["/lanes/0/reported/detail"]);
  });

  it("rejects a forbidden key nested in an array", () => {
    expectEnvelopePaths(withDetail({ rows: [{ ok: 1 }, { constructor: 2 }] }), [
      "/lanes/0/reported/detail",
    ]);
  });

  it("rejects a control character in a nested string", () => {
    expectEnvelopePaths(withDetail({ nested: { note: `bad${BELL}` } }), [
      "/lanes/0/reported/detail",
    ]);
  });

  it("accepts a detail nested 8 levels deep", () => {
    expect(
      expectValidEnvelope(withDetail(nestedDetail(8))).lanes[0]?.reported
        ?.detail,
    ).toEqual(nestedDetail(8));
  });

  it("rejects a detail nested 9 levels deep", () => {
    expectEnvelopePaths(withDetail(nestedDetail(9)), [
      "/lanes/0/reported/detail",
    ]);
  });

  it("accepts an array nested up to the depth limit", () => {
    expect(
      expectValidEnvelope(withDetail({ rows: nestedArray(6) })).lanes[0]
        ?.reported?.detail,
    ).toEqual({ rows: nestedArray(6) });
  });

  it("rejects an object nested past the depth limit", () => {
    expectEnvelopePaths(withDetail({ rows: nestedArray(7) }), [
      "/lanes/0/reported/detail",
    ]);
  });

  it("rejects an array nested past the depth limit", () => {
    expectEnvelopePaths(withDetail({ rows: nestedArray(8) }), [
      "/lanes/0/reported/detail",
    ]);
  });

  it("accepts 256 keys", () => {
    const detail: Record<string, unknown> = {};
    for (let index = 0; index < 256; index += 1) {
      detail[`k${index}`] = index;
    }

    expect(
      expectValidEnvelope(withDetail(detail)).lanes[0]?.reported?.detail,
    ).toEqual(detail);
  });

  it("rejects 257 keys", () => {
    const detail: Record<string, unknown> = {};
    for (let index = 0; index < 257; index += 1) {
      detail[`k${index}`] = index;
    }

    expectEnvelopePaths(withDetail(detail), ["/lanes/0/reported/detail"]);
  });

  it("counts keys across the whole detail", () => {
    const detail: Record<string, unknown> = {};
    for (let index = 0; index < 200; index += 1) {
      detail[`a${index}`] = {};
    }
    for (let index = 0; index < 100; index += 1) {
      detail["a0"] = { ...(detail["a0"] as object), [`b${index}`]: index };
    }

    expectEnvelopePaths(withDetail(detail), ["/lanes/0/reported/detail"]);
  });

  it("accepts a detail of exactly 8192 serialized bytes", () => {
    const detail = detailOfBytes(8192);
    expect(serializedBytes(detail)).toBe(8192);
    expect(
      expectValidEnvelope(withDetail(detail)).lanes[0]?.reported?.detail,
    ).toEqual(detail);
  });

  it("rejects a detail of 8193 serialized bytes", () => {
    expectEnvelopePaths(withDetail(detailOfBytes(8193)), [
      "/lanes/0/reported/detail",
    ]);
  });

  it("reports the byte cap before walking the keys", () => {
    const detail = { ...detailOfBytes(8200), constructor: 1 };

    expectEnvelopePaths(withDetail(detail), ["/lanes/0/reported/detail"]);
  });

  it("rejects a detail that is not an object", () => {
    expectEnvelopePaths(withDetail([]), ["/lanes/0/reported/detail"]);
    expectEnvelopePaths(withDetail("text"), ["/lanes/0/reported/detail"]);
    expectEnvelopePaths(withDetail(null), ["/lanes/0/reported/detail"]);
  });
});
