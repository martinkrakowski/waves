import { describe, expect, it } from "vitest";

import { validateEnvelope } from "../src/index.js";
import {
  errorsOf,
  expectEnvelopePaths,
  minimalEnvelope,
  minimalLane,
  oneLane,
} from "./support.js";

const megabyte = 1_048_576;

describe("validateEnvelope untrusted input", () => {
  it("rejects undefined with one root error", () => {
    expectEnvelopePaths(undefined, [""]);
  });

  it("rejects a circular value with one root error", () => {
    const circular: Record<string, unknown> = { ...minimalEnvelope() };
    circular["self"] = circular;

    expect(
      errorsOf(validateEnvelope(circular)).map((issue) => [
        issue.path,
        issue.message,
      ]),
    ).toEqual([["", "input is not serialisable JSON"]]);
  });

  it("rejects a BigInt with one root error", () => {
    expectEnvelopePaths({ ...minimalEnvelope(), big: 1n }, [""]);
  });

  it("rejects a throwing getter with one root error", () => {
    const input = { ...minimalEnvelope() } as Record<string, unknown>;
    Object.defineProperty(input, "wave", {
      enumerable: true,
      get: () => {
        throw new Error("boom");
      },
    });

    expectEnvelopePaths(input, [""]);
  });

  it("rejects a proxy trap with one root error", () => {
    const trapped = new Proxy({} as Record<string, unknown>, {
      ownKeys: () => {
        throw new Error("boom");
      },
    });

    expectEnvelopePaths(trapped, [""]);
  });

  it("rejects an input larger than 1 MiB with one root error", () => {
    const issues = errorsOf(
      validateEnvelope({
        ...minimalEnvelope(),
        project: "ALPHA",
        generatedAt: "x".repeat(megabyte),
      }),
    );

    expect(issues.map((issue) => [issue.path, issue.message])).toEqual([
      ["", "envelope larger than 1 MiB"],
    ]);
  });

  it("rejects a 5 MB string field with the root cap and no field errors", () => {
    const issues = errorsOf(
      validateEnvelope(
        oneLane({
          derived: { alive: true, planReview: "x".repeat(5 * megabyte) },
        }),
      ),
    );

    expect(issues.map((issue) => issue.path)).toEqual([""]);
  });

  it("reads each property once and validates the plain copy", () => {
    let reads = 0;
    const input = { ...minimalEnvelope() } as Record<string, unknown>;
    Object.defineProperty(input, "wave", {
      enumerable: true,
      get: () => {
        reads += 1;
        return reads === 1 ? "wv1" : "wv2";
      },
    });

    const result = validateEnvelope(input);

    expect(result.ok).toBe(true);
    expect(reads).toBe(1);
    if (!result.ok) {
      throw new Error("expected a valid envelope");
    }
    expect(result.value.wave).toBe("wv1");
    expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype);
    expect(Object.keys(result.value)).toEqual(Object.keys(minimalEnvelope()));
  });

  it("does not see fields inherited from a prototype", () => {
    const input = Object.create({
      project: "alpha",
      lanes: [minimalLane()],
    }) as Record<string, unknown>;
    Object.assign(input, {
      schema: "waves/v1",
      wave: "wv1",
      generatedAt: "2026-10-01T12:00:00Z",
      intervalSeconds: null,
    });

    expectEnvelopePaths(input, ["/project", "/lanes"]);
  });

  it("rejects a JSON __proto__ key as unknown", () => {
    const input = JSON.parse(
      '{"__proto__":{"schema":"waves/v1"},"schema":"waves/v1","project":"alpha","wave":"wv1","generatedAt":"2026-10-01T12:00:00Z","intervalSeconds":null,"lanes":[]}',
    ) as unknown;

    const issues = errorsOf(validateEnvelope(input));

    expect(issues.map((issue) => issue.path)).toEqual(["/__proto__"]);
  });

  it("does not accept an inherited required field", () => {
    Object.defineProperty(Object.prototype, "derived", {
      value: { alive: true },
      configurable: true,
    });
    try {
      expectEnvelopePaths(oneLane({ derived: undefined }), [
        "/lanes/0/derived",
      ]);
    } finally {
      delete (Object.prototype as Record<string, unknown>)["derived"];
    }
  });

  it("rejects 10000 lanes with one error and no per lane work", () => {
    const lanes = Array.from({ length: 10000 }, () =>
      minimalLane({ id: "not a lane id" }),
    );

    const issues = errorsOf(validateEnvelope({ ...minimalEnvelope(), lanes }));

    expect(issues.map((issue) => issue.path)).toEqual(["/lanes"]);
  });
});
