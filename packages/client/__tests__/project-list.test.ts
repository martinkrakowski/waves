import { describe, expect, it } from "vitest";

import {
  MAX_PROJECT_LIST,
  readProjectList,
  type ProjectEntry,
} from "../src/domain/project-list.js";

function errorsOf(text: string): readonly string[] {
  const read = readProjectList(text);
  if (read.ok) {
    throw new Error(`expected a refusal, got ${text}`);
  }
  return read.errors;
}

function entriesOf(text: string): readonly ProjectEntry[] {
  const read = readProjectList(text);
  if (!read.ok) {
    throw new Error(
      `expected ${text} to be accepted: ${read.errors.join("; ")}`,
    );
  }
  return read.entries;
}

function list(...entries: readonly unknown[]): string {
  return JSON.stringify(entries);
}

function many(count: number): string {
  return list(
    ...Array.from({ length: count }, (_unused, index) => ({
      id: `p-${String(index)}`,
      name: "n",
    })),
  );
}

describe("readProjectList", () => {
  it("reads the three fields an entry may carry", () => {
    expect(
      entriesOf(
        list(
          { id: "client-portal", name: "Client Portal" },
          {
            id: "waves-demo",
            name: "Waves Demo",
            repo: "https://github.com/example/waves.git",
          },
        ),
      ),
    ).toEqual([
      { id: "client-portal", name: "Client Portal", repo: undefined },
      {
        id: "waves-demo",
        name: "Waves Demo",
        repo: "https://github.com/example/waves.git",
      },
    ]);
  });

  it("takes an empty list, which has nothing to register", () => {
    expect(entriesOf("[]")).toEqual([]);
  });

  it("wants JSON", () => {
    expect(errorsOf("{ id: one }")).toEqual(["projects file is not JSON"]);
    expect(errorsOf("")).toEqual(["projects file is not JSON"]);
  });

  it("wants an array of projects", () => {
    expect(errorsOf('{"id":"one","name":"One"}')).toEqual([
      "projects file must be a JSON array of projects",
    ]);
    expect(errorsOf("42")).toEqual([
      "projects file must be a JSON array of projects",
    ]);
  });

  it("takes at most 64 entries, skipped ones included", () => {
    expect(entriesOf(many(MAX_PROJECT_LIST))).toHaveLength(MAX_PROJECT_LIST);
    expect(errorsOf(many(MAX_PROJECT_LIST + 1))).toEqual([
      "projects file has 65 entries; at most 64 are allowed",
    ]);
  });

  it("wants an object per entry", () => {
    expect(errorsOf(list(["one"], null))).toEqual([
      "entry 0: must be an object with id, name and an optional repo",
      "entry 1: must be an object with id, name and an optional repo",
    ]);
  });

  it("wants no key a project does not have", () => {
    expect(errorsOf(list({ id: "one", name: "One", branch: "main" }))).toEqual([
      "entry 0: holds a key a project does not have",
    ]);
  });

  it("applies the rules register applies, and names the key", () => {
    expect(errorsOf(list({ id: "Waves Demo", name: "One" }))).toEqual([
      "entry 0: id is not a project id",
    ]);
    expect(errorsOf(list({ id: "one", name: "" }))).toEqual([
      "entry 0: name: expected at least 1 characters",
    ]);
    expect(errorsOf(list({ id: "one", name: "x".repeat(81) }))).toEqual([
      "entry 0: name: expected at most 80 characters",
    ]);
    expect(
      errorsOf(list({ id: "one", name: `two${String.fromCharCode(7)}lines` })),
    ).toEqual(["entry 0: name: expected printable text"]);
    expect(
      errorsOf(list({ id: "one", name: "One", repo: "example.com" })),
    ).toEqual(["entry 0: repo: expected an https URL"]);
    expect(
      errorsOf(
        list({
          id: "one",
          name: "One",
          repo: `https://example.com/${"x".repeat(200)}`,
        }),
      ),
    ).toEqual(["entry 0: repo: expected at most 200 characters"]);
  });

  it("refuses a repo that carries a password, which the console renders", () => {
    expect(
      errorsOf(
        list({ id: "one", name: "One", repo: "https://user:pw@example.com/" }),
      ),
    ).toEqual(["entry 0: repo: expected no user or password in the URL"]);
  });

  it("names a field of the wrong type, and not what was in it", () => {
    expect(errorsOf(list({ id: 7, name: "One", repo: [] }))).toEqual([
      "entry 0: id must be a string",
      "entry 0: repo must be a string",
    ]);
    expect(errorsOf(list({ id: "one", name: null }))).toEqual([
      "entry 0: name must be a string",
    ]);
  });

  it("wants no id twice, and says which entry the second one is", () => {
    expect(
      errorsOf(
        list(
          { id: "one", name: "One" },
          { id: "two", name: "Two" },
          { id: "one", name: "One again" },
        ),
      ),
    ).toEqual(["entry 2: id is one the list already has"]);
  });

  it("collects every error, and each one names its entry by index", () => {
    expect(
      errorsOf(
        list(
          { id: "Waves Demo", name: "One" },
          { id: "two", name: "Two", branch: "main" },
          { id: "three", name: "" },
          { id: "four", name: "Four", repo: "https://user:pw@example.com/" },
          { id: 7, name: 7, repo: 7 },
        ),
      ),
    ).toEqual([
      "entry 0: id is not a project id",
      "entry 1: holds a key a project does not have",
      "entry 2: name: expected at least 1 characters",
      "entry 3: repo: expected no user or password in the URL",
      "entry 4: id must be a string",
      "entry 4: name must be a string",
      "entry 4: repo must be a string",
    ]);
  });

  it("quotes no value from the file, which a launchd log would keep", () => {
    const errors = errorsOf(
      list(
        { id: "Not An Id", name: "x".repeat(81) },
        { id: "one", name: "One", repo: "https://user:hunter2@example.com/" },
      ),
    );
    expect(errors).toEqual([
      "entry 0: id is not a project id",
      "entry 0: name: expected at most 80 characters",
      "entry 1: repo: expected no user or password in the URL",
    ]);
    for (const error of errors) {
      expect(error).not.toContain("hunter2");
      expect(error).not.toContain("Not An Id");
      expect(error).not.toContain("x".repeat(81));
    }
  });
});
