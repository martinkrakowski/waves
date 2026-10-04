import { describe, expect, it } from "vitest";

import {
  DEFAULT_EVERY_SECONDS,
  readSyncConfig,
  type SyncConfig,
} from "../src/domain/sync-config.js";

const COMMAND = ["/usr/local/bin/waves-collect", "--json"];

const ENTRY: Record<string, unknown> = {
  project: "waves-demo",
  command: COMMAND,
  cwd: "/srv/demo",
};

/** The file as the owner's list of projects reads it, with one entry changed. */
function fileOf(entry: Record<string, unknown> = {}): string {
  return JSON.stringify({
    projects: [{ ...ENTRY, ...entry }],
  });
}

/** The file with a top-level key changed. */
function configOf(over: Record<string, unknown> = {}): string {
  return JSON.stringify({ projects: [{ ...ENTRY }], ...over });
}

function accepted(text: string): SyncConfig {
  const read = readSyncConfig(text);
  if (!read.ok) {
    throw new Error(
      `expected this file to be accepted: ${read.errors.join("; ")}`,
    );
  }
  return read.config;
}

function refused(text: string): readonly string[] {
  const read = readSyncConfig(text);
  if (read.ok) {
    throw new Error(`expected this file to be refused: ${text}`);
  }
  return read.errors;
}

describe("a file as the owner writes it", () => {
  it("is one project per entry, with the two numbers defaulted", () => {
    expect(accepted(configOf())).toEqual({
      every: DEFAULT_EVERY_SECONDS,
      projects: [
        {
          project: "waves-demo",
          command: COMMAND,
          cwd: "/srv/demo",
          timeoutSeconds: 20,
        },
      ],
    });
  });

  it("takes the period and the deadlines the file gives", () => {
    const config = accepted(
      JSON.stringify({
        every: 45,
        projects: [
          { ...ENTRY, timeoutSeconds: 22 },
          {
            project: "client-portal",
            command: COMMAND,
            cwd: "/srv/portal",
          },
        ],
      }),
    );

    expect(config.every).toBe(45);
    expect(config.projects[0]?.timeoutSeconds).toBe(22);
    // The second entry takes the default, which follows the period rather than
    // asking the owner for a second number in the file.
    expect(config.projects[1]).toEqual({
      project: "client-portal",
      command: COMMAND,
      cwd: "/srv/portal",
      timeoutSeconds: 20,
    });
  });

  it("keeps the order the file has, which is the order the run uses", () => {
    const config = accepted(
      JSON.stringify({
        projects: [
          { project: "b-project", command: COMMAND, cwd: "/srv/b" },
          { project: "a-project", command: COMMAND, cwd: "/srv/a" },
        ],
      }),
    );

    expect(config.projects.map((entry) => entry.project)).toEqual([
      "b-project",
      "a-project",
    ]);
  });

  it("takes both ends of the period's range", () => {
    expect(accepted(configOf({ every: 10 })).every).toBe(10);
    expect(accepted(configOf({ every: 100 })).every).toBe(100);
  });

  it("caps a collector at half the period, and defaults inside that cap", () => {
    const capped = accepted(
      JSON.stringify({
        every: 30,
        projects: [{ ...ENTRY, timeoutSeconds: 15 }],
      }),
    );
    expect(capped.every).toBe(30);
    expect(capped.projects[0]?.timeoutSeconds).toBe(15);
    // At a period of 10 seconds the default is 5, not the 20 a longer period
    // would take.
    expect(accepted(configOf({ every: 10 })).projects[0]?.timeoutSeconds).toBe(
      5,
    );
  });
});

describe("a file that is not the object this client reads", () => {
  it("is refused for what it is", () => {
    expect(refused("not json")).toEqual(["sync.json is not JSON"]);
    expect(refused("[]")).toEqual([
      "sync.json must be a JSON object with every and projects",
    ]);
    expect(refused('"every"')).toEqual([
      "sync.json must be a JSON object with every and projects",
    ]);
  });

  it("is refused for a key it does not know, at either level", () => {
    expect(refused(configOf({ waves: [] }))).toEqual([
      "sync.json holds a key this client does not know",
    ]);
    expect(refused(fileOf({ env: { PATH: "/usr/bin" } }))).toEqual([
      "project 0: holds a key this client does not know",
    ]);
  });

  it("collects every mistake rather than the first", () => {
    expect(
      refused(
        JSON.stringify({
          every: 9,
          projects: [{ ...ENTRY, command: ["collect"], cwd: "demo" }],
        }),
      ),
    ).toEqual([
      "every must be between 10 and 100 seconds",
      "project 0: command[0] must be an absolute path",
      "project 0: cwd must be an absolute path",
    ]);
  });
});

describe("the period", () => {
  it("wants a whole number of seconds", () => {
    expect(refused(configOf({ every: 60.5 }))).toEqual([
      "every must be a whole number of seconds",
    ]);
    expect(refused(configOf({ every: "60" }))).toEqual([
      "every must be a whole number of seconds",
    ]);
  });

  it("wants between ten and a hundred seconds", () => {
    const message = "every must be between 10 and 100 seconds";
    expect(refused(configOf({ every: 9 }))).toEqual([message]);
    expect(refused(configOf({ every: 101 }))).toEqual([message]);
  });
});

describe("one collector's own deadline", () => {
  it("wants a whole number of seconds between one and thirty", () => {
    expect(refused(fileOf({ timeoutSeconds: 20.5 }))).toEqual([
      "project 0: timeoutSeconds must be a whole number",
    ]);
    expect(refused(fileOf({ timeoutSeconds: "20" }))).toEqual([
      "project 0: timeoutSeconds must be a whole number",
    ]);
    expect(refused(fileOf({ timeoutSeconds: 0 }))).toEqual([
      "project 0: timeoutSeconds must be between 1 and 30",
    ]);
    expect(refused(fileOf({ timeoutSeconds: 31 }))).toEqual([
      "project 0: timeoutSeconds must be between 1 and 30",
    ]);
    expect(accepted(fileOf({ timeoutSeconds: 1 })).projects[0]).toMatchObject({
      timeoutSeconds: 1,
    });
    expect(accepted(fileOf({ timeoutSeconds: 30 })).projects[0]).toMatchObject({
      timeoutSeconds: 30,
    });
  });

  it("is refused above half the period, which is the rule that matters", () => {
    // With a period of 20 the cap is 10 seconds, so 11 is refused and 10 is not.
    const at = (timeoutSeconds: number): string =>
      JSON.stringify({
        every: 20,
        projects: [{ ...ENTRY, timeoutSeconds }],
      });
    expect(refused(at(11))).toEqual([
      "project 0: timeoutSeconds must be at most half of every (10)",
    ]);
    expect(accepted(at(10)).projects[0]?.timeoutSeconds).toBe(10);
  });
});

describe("the projects a file names", () => {
  it("must be a non-empty array of objects", () => {
    expect(refused(configOf({ projects: "one" }))).toEqual([
      "projects must be a JSON array",
    ]);
    expect(refused(configOf({ projects: [] }))).toEqual([
      "projects must name at least one project",
    ]);
    expect(refused(configOf({ projects: ["waves-demo"] }))).toEqual([
      "project 0: must be an object",
    ]);
  });

  it("must each name a project id, and no id twice", () => {
    expect(refused(fileOf({ project: "Waves Demo" }))).toEqual([
      "project 0: project is not a project id",
    ]);
    expect(refused(fileOf({ project: 7 }))).toEqual([
      "project 0: project must be a string",
    ]);
    expect(
      refused(
        JSON.stringify({
          projects: [{ ...ENTRY }, { ...ENTRY, cwd: "/srv/other" }],
        }),
      ),
    ).toEqual(["project 1: project is one the file already has"]);
  });

  it("must name an absolute program, with its arguments after it", () => {
    expect(refused(fileOf({ command: ["waves-collect"] }))).toEqual([
      "project 0: command[0] must be an absolute path",
    ]);
    expect(refused(fileOf({ command: [] }))).toEqual([
      "project 0: command must name a program to run",
    ]);
    expect(refused(fileOf({ command: 7 }))).toEqual([
      "project 0: command must be an array of strings",
    ]);
    expect(refused(fileOf({ command: ["/usr/bin/collect", 7] }))).toEqual([
      "project 0: command must be an array of strings",
    ]);
    // A whole command line is the shape this client refuses rather than parses:
    // it has no shell, so nothing in an entry is ever expanded or split.
    expect(
      refused(fileOf({ command: "/usr/bin/collect --json 2>&1" })),
    ).toEqual(["project 0: command must be an array of strings"]);
  });

  it("must name an absolute directory to work in", () => {
    expect(refused(fileOf({ cwd: "demo" }))).toEqual([
      "project 0: cwd must be an absolute path",
    ]);
    expect(refused(fileOf({ cwd: 7 }))).toEqual([
      "project 0: cwd must be a string",
    ]);
    expect(
      refused(
        JSON.stringify({ projects: [{ project: "a", command: COMMAND }] }),
      ),
    ).toEqual(["project 0: cwd must be a string"]);
  });
});
