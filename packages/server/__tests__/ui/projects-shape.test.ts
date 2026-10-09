import { describe, expect, it } from "vitest";

import { drawableProjects } from "../../public/projects.js";

import { projectCard, recentWave, statusFacts } from "./fixtures.js";

/**
 * The only question `projects.js` answers now: whether a response is a list the
 * page can draw at all. The list itself is drawn by the rail and the fleet page,
 * which have their own tests.
 */
describe("drawableProjects", () => {
  it("takes a list of projects, and an empty one", () => {
    expect(drawableProjects([projectCard()])).toBe(true);
    expect(drawableProjects([])).toBe(true);
  });

  it("takes a summary with recent waves, and one with none at all", () => {
    expect(drawableProjects([projectCard()])).toBe(true);
    expect(
      drawableProjects([
        projectCard({
          recentWaves: [recentWave(), recentWave({ wave: "w-2" })],
        }),
      ]),
    ).toBe(true);
    expect(
      drawableProjects([
        projectCard({
          recentWaves: Array.from({ length: 12 }, (_unused, at) =>
            recentWave({ wave: `w-${at}` }),
          ),
        }),
      ]),
    ).toBe(true);
  });

  it("takes a project with a status, and one without", () => {
    expect(drawableProjects([projectCard({ status: statusFacts() })])).toBe(
      true,
    );
    expect(
      drawableProjects([
        projectCard({
          status: { receivedAt: "2026-04-01T12:00:00.000Z", stale: false },
        }),
      ]),
    ).toBe(true);
  });

  it("takes a project with decision counts, and one without", () => {
    expect(drawableProjects([projectCard()])).toBe(true);
    expect(
      drawableProjects([
        projectCard({
          decisions: { waiting: 3, oneWay: 1, reported: 2, closed: 1 },
        }),
      ]),
    ).toBe(true);
    expect(drawableProjects([projectCard({ decisions: undefined })])).toBe(
      true,
    );
  });

  it("refuses a decisions count that is not a whole number of at least zero", () => {
    for (const field of ["waiting", "oneWay", "reported", "closed"] as const) {
      expect(
        drawableProjects([
          projectCard({
            decisions: {
              waiting: 0,
              oneWay: 0,
              reported: 0,
              closed: 0,
              [field]: -1,
            } as never,
          }),
        ]),
      ).toBe(false);
      expect(
        drawableProjects([
          projectCard({
            decisions: {
              waiting: 0,
              oneWay: 0,
              reported: 0,
              closed: 0,
              [field]: 1.5,
            } as never,
          }),
        ]),
      ).toBe(false);
      expect(
        drawableProjects([
          projectCard({
            decisions: {
              waiting: 0,
              oneWay: 0,
              reported: 0,
              closed: 0,
              [field]: "1",
            } as never,
          }),
        ]),
      ).toBe(false);
    }
  });

  it("refuses a oneWay above waiting", () => {
    expect(
      drawableProjects([
        projectCard({
          decisions: { waiting: 1, oneWay: 2, reported: 0, closed: 0 },
        }),
      ]),
    ).toBe(false);
  });

  it("refuses a decisions field that is not a countable object", () => {
    expect(drawableProjects([projectCard({ decisions: null as never })])).toBe(
      false,
    );
    expect(drawableProjects([projectCard({ decisions: 42 as never })])).toBe(
      false,
    );
    expect(drawableProjects([projectCard({ decisions: "no" as never })])).toBe(
      false,
    );
    expect(
      drawableProjects([projectCard({ decisions: { waiting: 1 } as never })]),
    ).toBe(false);
  });

  it("refuses an entry it could not draw", () => {
    expect(drawableProjects([null])).toBe(false);
    expect(drawableProjects([projectCard(), null])).toBe(false);
    expect(drawableProjects([{}])).toBe(false);
    expect(drawableProjects([{ ...projectCard(), stale: undefined }])).toBe(
      false,
    );
    expect(drawableProjects([{ ...projectCard(), waves: "3" }])).toBe(false);
    expect(drawableProjects([{ ...projectCard(), name: 7 }])).toBe(false);
    expect(drawableProjects([{ ...projectCard(), lanes: undefined }])).toBe(
      false,
    );
    expect(drawableProjects([{ ...projectCard(), lanes: "6" }])).toBe(false);
  });

  it("takes a repository as a string, and takes no repository at all", () => {
    expect(drawableProjects([projectCard()])).toBe(true);
    expect(
      drawableProjects([projectCard({ repo: "https://git.example.test/a" })]),
    ).toBe(true);
    expect(drawableProjects([projectCard({ repo: undefined })])).toBe(true);
    // The contract reads this field through `readOptional`, so `undefined` is
    // how it says "no repository" — and it never says it any other way. A
    // summary carrying anything else is a failed load, and the fleet's search
    // lowercases this field: without the rule, one bad entry would throw inside
    // a draw the first time a reader searched.
    expect(drawableProjects([{ ...projectCard(), repo: 42 }])).toBe(false);
    expect(drawableProjects([{ ...projectCard(), repo: null }])).toBe(false);
    expect(
      drawableProjects([
        { ...projectCard(), repo: { href: "https://g.test/a" } },
      ]),
    ).toBe(false);
    expect(
      drawableProjects([{ ...projectCard(), repo: ["https://g.test"] }]),
    ).toBe(false);
  });

  it("refuses a recent wave it could not draw rather than drawing half of it", () => {
    const broken = [
      null,
      "w-3",
      {},
      { ...recentWave(), wave: 7 },
      { ...recentWave(), wave: "" },
      // A wave id the page has no path for, and one with a slash in it.
      { ...recentWave(), wave: "a b" },
      { ...recentWave(), wave: "../escape" },
      { ...recentWave(), receivedAt: undefined },
      { ...recentWave(), receivedAt: 1_759_320_000_000 },
      { ...recentWave(), lanes: -1 },
      { ...recentWave(), lanes: 1.5 },
      { ...recentWave(), lanes: "2" },
      { ...recentWave(), lanes: Number.MAX_SAFE_INTEGER + 2 },
      { ...recentWave(), merged: -1 },
      { ...recentWave(), merged: "1" },
      // More merged pull requests than lanes: a ring the page would draw as more
      // than all of them, which is a broken endpoint, not a card to guess at.
      { ...recentWave(), lanes: 1, merged: 2 },
      { ...recentWave(), state: undefined },
      { ...recentWave(), state: "queued" },
      { ...recentWave(), state: "Failed" },
      { ...recentWave(), stale: undefined },
      { ...recentWave(), stale: "false" },
    ];
    for (const wave of broken) {
      expect(
        drawableProjects([projectCard({ recentWaves: [wave as never] })]),
        String(JSON.stringify(wave)),
      ).toBe(false);
    }
  });

  it("refuses a recent wave list that is not one, or is longer than the bound", () => {
    for (const list of [undefined, null, {}, "w-3", { w: "w-3" }, [{ w: 7 }]]) {
      expect(
        drawableProjects([projectCard({ recentWaves: list as never })]),
        String(JSON.stringify(list)),
      ).toBe(false);
    }
    expect(
      drawableProjects([
        projectCard({
          recentWaves: Array.from({ length: 13 }, (_unused, at) =>
            recentWave({ wave: `w-${at}` }),
          ),
        }),
      ]),
    ).toBe(false);
  });

  it("refuses a status it could not read, rather than showing half of it", () => {
    const broken = [
      null,
      {},
      { stale: false },
      { receivedAt: 7, stale: false },
      { receivedAt: "2026-04-01T12:00:00.000Z" },
      { receivedAt: "2026-04-01T12:00:00.000Z", stale: false, prsSkipped: -1 },
      { receivedAt: "2026-04-01T12:00:00.000Z", stale: false, prsSkipped: "2" },
      {
        receivedAt: "2026-04-01T12:00:00.000Z",
        stale: false,
        backlogState: "invented",
      },
    ];
    for (const status of broken) {
      expect(
        drawableProjects([projectCard({ status: status as never })]),
        String(JSON.stringify(status)),
      ).toBe(false);
    }
  });

  it("refuses anything that is not a list", () => {
    expect(drawableProjects(undefined)).toBe(false);
    expect(drawableProjects({})).toBe(false);
  });
});
