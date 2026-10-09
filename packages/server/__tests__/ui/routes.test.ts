import { describe, expect, it } from "vitest";

import { routeOf } from "../../public/app.js";
import { pathFor } from "../../public/views/project.js";

describe("routeOf", () => {
  it("routes the root at the project list", () => {
    expect(routeOf("/")).toStrictEqual({ kind: "projects" });
    expect(routeOf("")).toStrictEqual({ kind: "projects" });
  });

  it("routes /inbox at the inbox", () => {
    expect(routeOf("/inbox")).toStrictEqual({ kind: "inbox" });
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

describe("pathFor", () => {
  it("writes the path a route is drawn at", () => {
    expect(pathFor("alpha", undefined)).toBe("/p/alpha");
    expect(pathFor("alpha", "wv1")).toBe("/p/alpha/w/wv1");
  });

  it("encodes a segment it would not otherwise leave alone", () => {
    expect(pathFor("a b", undefined)).toBe("/p/a%20b");
    expect(pathFor("alpha", "w/1")).toBe("/p/alpha/w/w%2F1");
  });

  it("round-trips with routeOf on every path the page serves", () => {
    for (const pathname of [
      "/",
      "/p/alpha",
      "/p/a-b9",
      "/p/alpha/w/wv1",
      "/p/alpha/w/w_v-1",
    ]) {
      const route = routeOf(pathname);
      const path =
        route.kind === "project" ? pathFor(route.id, route.wave) : "/";
      expect(routeOf(path)).toStrictEqual(route);
    }
  });
});
