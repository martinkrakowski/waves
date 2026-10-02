import { describe, expect, it } from "vitest";

import { routeOf } from "../../public/app.js";

describe("routeOf", () => {
  it("routes the root at the project list", () => {
    expect(routeOf("/")).toStrictEqual({ kind: "projects" });
    expect(routeOf("")).toStrictEqual({ kind: "projects" });
  });

  it("routes /p/<id> at one project, decoded", () => {
    expect(routeOf("/p/alpha")).toStrictEqual({ kind: "project", id: "alpha" });
    expect(routeOf("/p/a%20b")).toStrictEqual({ kind: "project", id: "a b" });
  });

  it("routes /p/<id>/w/<wave> at that project, never at an id holding the wave", () => {
    expect(routeOf("/p/alpha/w/wv1")).toStrictEqual({
      kind: "project",
      id: "alpha",
    });
  });

  it("refuses a path with no id, or an id it cannot decode", () => {
    expect(routeOf("/p/")).toStrictEqual({ kind: "unknown" });
    expect(routeOf("/p/%zz")).toStrictEqual({ kind: "unknown" });
  });

  it("refuses anything else", () => {
    expect(routeOf("/projects")).toStrictEqual({ kind: "unknown" });
    expect(routeOf("/app.js")).toStrictEqual({ kind: "unknown" });
  });
});
