import { describe, expect, it } from "vitest";

import {
  allowOf,
  route,
  type Route,
} from "../src/infrastructure/http-routes.js";

const ROOT = "/srv/waves/public";

function routed(pathname: string): Route {
  return route(pathname, ROOT);
}

describe("route", () => {
  it("maps a decision's nonce and answers paths", () => {
    expect(routed("/api/v1/projects/alpha/decisions/d1/nonce")).toEqual({
      kind: "decisionNonce",
      project: "alpha",
      id: "d1",
    });
    expect(routed("/api/v1/projects/alpha/decisions/d1/answers")).toEqual({
      kind: "decisionAnswers",
      project: "alpha",
      id: "d1",
    });
  });

  it("allows only POST on both answer paths", () => {
    expect(allowOf(routed("/api/v1/projects/alpha/decisions/d1/nonce"))).toBe(
      "POST",
    );
    expect(allowOf(routed("/api/v1/projects/alpha/decisions/d1/answers"))).toBe(
      "POST",
    );
  });

  it("refuses the answer paths for ids the contract refuses", () => {
    expect(routed("/api/v1/projects/not+an+id/decisions/d1/nonce")).toEqual({
      kind: "missing",
    });
    expect(routed("/api/v1/projects/alpha/decisions/bad id/nonce")).toEqual({
      kind: "missing",
    });
    expect(routed("/api/v1/projects/alpha/decisions/bad id/answers")).toEqual({
      kind: "missing",
    });
  });

  it("still maps the states path beside the new ones", () => {
    expect(routed("/api/v1/projects/alpha/decisions/d1/states")).toEqual({
      kind: "decisionStates",
      project: "alpha",
      id: "d1",
    });
  });
});
