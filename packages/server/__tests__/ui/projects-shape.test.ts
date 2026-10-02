import { describe, expect, it } from "vitest";

import { drawableProjects } from "../../public/projects.js";

import { projectCard } from "./fixtures.js";

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

  it("refuses anything that is not a list", () => {
    expect(drawableProjects(undefined)).toBe(false);
    expect(drawableProjects({})).toBe(false);
  });
});
