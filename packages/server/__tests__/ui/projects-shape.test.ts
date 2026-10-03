import { describe, expect, it } from "vitest";

import { drawableProjects } from "../../public/projects.js";

import { projectCard, statusFacts } from "./fixtures.js";

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
