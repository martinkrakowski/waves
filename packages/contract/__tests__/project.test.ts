import { describe, expect, it } from "vitest";

import { validateProject, type ValidationIssue } from "../src/index.js";

const TOKEN = "a".repeat(64);

function project(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "alpha",
    name: "Alpha",
    tokenSha256: TOKEN,
    registeredAt: "2026-10-01T12:00:00Z",
    ...patch,
  };
}

function errors(input: unknown): readonly ValidationIssue[] {
  const result = validateProject(input);
  if (result.ok) {
    throw new Error("expected the project to be rejected");
  }
  return result.errors;
}

function expectPaths(input: unknown, expected: readonly string[]): void {
  expect(errors(input).map((issue) => issue.path)).toEqual(expected);
}

function expectValid(input: unknown): void {
  const result = validateProject(input);
  if (!result.ok) {
    throw new Error(
      `expected a valid project, got ${JSON.stringify(result.errors)}`,
    );
  }
  expect(result.value).toEqual(input);
}

describe("validateProject", () => {
  it("accepts a project without a repository", () => {
    expectValid(project());
  });

  it("accepts a project with an https repository", () => {
    expectValid(project({ repo: "https://example.com/alpha.git" }));
  });

  it("rejects a null root with a single root error", () => {
    expectPaths(null, [""]);
  });

  it("rejects an array root with a single root error", () => {
    expectPaths([], [""]);
  });

  it("rejects an unknown key", () => {
    expectPaths(project({ secret: "hunter2" }), ["/secret"]);
  });

  it("requires a project id", () => {
    expectPaths(project({ id: undefined }), ["/id"]);
    expectPaths(project({ id: 3 }), ["/id"]);
    expectPaths(project({ id: "Alpha" }), ["/id"]);
    expectPaths(project({ id: "a".repeat(64) }), ["/id"]);
  });

  it("requires a name of 1 to 80 characters", () => {
    expectPaths(project({ name: undefined }), ["/name"]);
    expectPaths(project({ name: "" }), ["/name"]);
    expectPaths(project({ name: "n".repeat(81) }), ["/name"]);
    expectPaths(project({ name: 7 }), ["/name"]);
  });

  it("accepts a name of 80 characters", () => {
    expectValid(project({ name: "n".repeat(80) }));
  });

  it("requires an https repository", () => {
    expectPaths(project({ repo: "http://example.com/alpha.git" }), ["/repo"]);
    expectPaths(project({ repo: "not a url" }), ["/repo"]);
    expectPaths(project({ repo: 7 }), ["/repo"]);
  });

  it("accepts a repository of 200 characters", () => {
    const prefix = "https://example.com/";
    expectValid(project({ repo: prefix + "a".repeat(200 - prefix.length) }));
  });

  it("rejects a repository of 201 characters", () => {
    const prefix = "https://example.com/";
    expectPaths(project({ repo: prefix + "a".repeat(201 - prefix.length) }), [
      "/repo",
    ]);
  });

  it("requires 64 lower case hexadecimal characters as the token digest", () => {
    expectPaths(project({ tokenSha256: undefined }), ["/tokenSha256"]);
    expectPaths(project({ tokenSha256: "a".repeat(63) }), ["/tokenSha256"]);
    expectPaths(project({ tokenSha256: "A".repeat(64) }), ["/tokenSha256"]);
    expectPaths(project({ tokenSha256: `${"a".repeat(63)}g` }), [
      "/tokenSha256",
    ]);
  });

  it("requires a UTC registeredAt", () => {
    expectPaths(project({ registeredAt: undefined }), ["/registeredAt"]);
    expectPaths(project({ registeredAt: "2026-10-01" }), ["/registeredAt"]);
  });

  it("collects every independent error", () => {
    expectPaths(project({ id: "ALPHA", name: "", repo: "ftp://example.com" }), [
      "/id",
      "/name",
      "/repo",
    ]);
  });

  it("rejects undefined with one root error", () => {
    expect(
      errors(undefined).map((issue) => [issue.path, issue.message]),
    ).toEqual([["/", "input is not serialisable JSON"]]);
  });

  it("rejects a project larger than 1 MiB with one root error", () => {
    const issues = errors({ ...project(), name: "n".repeat(1_048_576) });

    expect(issues.map((issue) => [issue.path, issue.message])).toEqual([
      ["/", "project larger than 1 MiB"],
    ]);
  });

  it("does not see a field inherited from a prototype", () => {
    const input = Object.create({ tokenSha256: TOKEN }) as Record<
      string,
      unknown
    >;
    Object.assign(input, {
      id: "alpha",
      name: "Alpha",
      registeredAt: "2026-10-01T12:00:00Z",
    });

    expectPaths(input, ["/tokenSha256"]);
  });
});
