import { describe, expect, it } from "vitest";

import { pathOf, routeOf } from "../../public/app.js";

describe("routeOf", () => {
  it("routes the root at the project list", () => {
    expect(routeOf("/")).toStrictEqual({ kind: "projects" });
    expect(routeOf("")).toStrictEqual({ kind: "projects" });
  });

  it("routes /p/<id> at one project", () => {
    expect(routeOf("/p/alpha")).toStrictEqual({ kind: "project", id: "alpha" });
    expect(routeOf("/p/a-b9")).toStrictEqual({ kind: "project", id: "a-b9" });
  });

  it("routes /p/<id>/w/<wave> at that wave of that project", () => {
    expect(routeOf("/p/alpha/w/wv1")).toStrictEqual({
      kind: "project",
      id: "alpha",
      wave: "wv1",
    });
    expect(routeOf("/p/alpha/w/w_v-1")).toStrictEqual({
      kind: "project",
      id: "alpha",
      wave: "w_v-1",
    });
  });

  it("refuses an id or a wave it would have to decode", () => {
    expect(routeOf("/p/a%20b")).toStrictEqual({ kind: "unknown" });
    expect(routeOf("/p/%zz")).toStrictEqual({ kind: "unknown" });
  });

  it("refuses a path with no id", () => {
    expect(routeOf("/p/")).toStrictEqual({ kind: "unknown" });
    expect(routeOf("/p")).toStrictEqual({ kind: "unknown" });
  });

  it("refuses a wave path that is not one, or names a wave it cannot use", () => {
    expect(routeOf("/p/alpha/w/")).toStrictEqual({ kind: "unknown" });
    expect(routeOf("/p/alpha/w/a/b")).toStrictEqual({ kind: "unknown" });
    expect(routeOf("/p/alpha/x/wv1")).toStrictEqual({ kind: "unknown" });
    expect(routeOf("/p/alpha/w/-bad")).toStrictEqual({ kind: "unknown" });
  });

  it("refuses an id the project pattern does not allow", () => {
    expect(routeOf("/p/ALPHA")).toStrictEqual({ kind: "unknown" });
    expect(routeOf("/p/-alpha")).toStrictEqual({ kind: "unknown" });
    expect(routeOf("/p/alpha.beta")).toStrictEqual({ kind: "unknown" });
  });

  it("refuses anything else", () => {
    expect(routeOf("/projects")).toStrictEqual({ kind: "unknown" });
    expect(routeOf("/app.js")).toStrictEqual({ kind: "unknown" });
  });
});

describe("pathOf", () => {
  it("writes the path a route is drawn at", () => {
    expect(pathOf({ kind: "projects" })).toBe("/");
    expect(pathOf({ kind: "unknown" })).toBe("/");
    expect(pathOf({ kind: "project", id: "alpha" })).toBe("/p/alpha");
    expect(pathOf({ kind: "project", id: "alpha", wave: "wv1" })).toBe(
      "/p/alpha/w/wv1",
    );
  });

  it("encodes a segment it would not otherwise leave alone", () => {
    expect(pathOf({ kind: "project", id: "a b" })).toBe("/p/a%20b");
    expect(pathOf({ kind: "project", id: "alpha", wave: "w/1" })).toBe(
      "/p/alpha/w/w%2F1",
    );
  });

  it("round-trips with routeOf on every path the page serves", () => {
    for (const pathname of [
      "/",
      "/p/alpha",
      "/p/a-b9",
      "/p/alpha/w/wv1",
      "/p/alpha/w/w_v-1",
    ]) {
      expect(routeOf(pathOf(routeOf(pathname)))).toStrictEqual(
        routeOf(pathname),
      );
    }
  });
});
