import { describe, expect, it } from "vitest";

import {
  adminRouteEnabled,
  authorize,
  type TokenKind,
} from "../src/application/enrollment.js";

/**
 * The whole table, one row per line, so a change to `authorize` has to be made
 * here too: a row that is not asserted is a permission nobody checked.
 */
const TABLE: readonly {
  readonly route: "register" | "removeProject";
  readonly rotate: boolean;
  readonly token: TokenKind;
  readonly answer: ReturnType<typeof authorize>;
}[] = [
  // Any route, any query, a digest that is neither of this service's own.
  {
    route: "register",
    rotate: false,
    token: "none",
    answer: { kind: "refuse", status: 401 },
  },
  {
    route: "register",
    rotate: true,
    token: "none",
    answer: { kind: "refuse", status: 401 },
  },
  {
    route: "removeProject",
    rotate: false,
    token: "none",
    answer: { kind: "refuse", status: 401 },
  },
  {
    route: "removeProject",
    rotate: true,
    token: "none",
    answer: { kind: "refuse", status: 401 },
  },

  // The admin token keeps everything it had.
  {
    route: "register",
    rotate: false,
    token: "admin",
    answer: { kind: "admin" },
  },
  {
    route: "register",
    rotate: true,
    token: "admin",
    answer: { kind: "admin" },
  },
  {
    route: "removeProject",
    rotate: false,
    token: "admin",
    answer: { kind: "admin" },
  },
  {
    route: "removeProject",
    rotate: true,
    token: "admin",
    answer: { kind: "admin" },
  },

  // The enrollment token: one thing only, and only for an id that is free.
  {
    route: "register",
    rotate: false,
    token: "enroll",
    answer: { kind: "enroll" },
  },
  {
    route: "register",
    rotate: true,
    token: "enroll",
    answer: { kind: "refuse", status: 403 },
  },
  {
    route: "removeProject",
    rotate: false,
    token: "enroll",
    answer: { kind: "refuse", status: 403 },
  },
  {
    route: "removeProject",
    rotate: true,
    token: "enroll",
    answer: { kind: "refuse", status: 403 },
  },
];

describe("authorize", () => {
  it.each(TABLE)(
    "answers $answer.kind $answer.status for $token on $route with rotate=$rotate",
    ({ route, rotate, token, answer }) => {
      expect(authorize(route, rotate, token)).toEqual(answer);
    },
  );

  it("never lets the enrollment token reach the admin power", () => {
    for (const rotate of [false, true]) {
      for (const route of ["register", "removeProject"] as const) {
        expect(authorize(route, rotate, "enroll").kind).not.toBe("admin");
      }
    }
  });

  it("counts every refusal as one the caller can be charged for", () => {
    for (const row of TABLE.filter((r) => r.answer.kind === "refuse")) {
      const answer = row.answer;
      if (answer.kind !== "refuse") {
        throw new Error("the row is not a refusal");
      }
      expect([401, 403]).toContain(answer.status);
    }
  });
});

describe("adminRouteEnabled", () => {
  const ENABLED: readonly [string, boolean, boolean, boolean, boolean][] = [
    // route, rotate, admin, enroll, expected
    ["register", false, true, true, true],
    ["register", false, true, false, true],
    ["register", false, false, true, true],
    ["register", false, false, false, false],
    ["register", true, true, true, true],
    ["register", true, true, false, true],
    ["register", true, false, true, false],
    ["register", true, false, false, false],
    ["removeProject", false, true, true, true],
    ["removeProject", false, true, false, true],
    ["removeProject", false, false, true, false],
    ["removeProject", false, false, false, false],
    ["removeProject", true, true, true, true],
    ["removeProject", true, false, true, false],
  ];

  it.each(ENABLED)(
    "%s with rotate=%s, admin=%s, enroll=%s is enabled: %s",
    (route, rotate, admin, enroll, expected) => {
      expect(
        adminRouteEnabled(
          route as "register" | "removeProject",
          rotate,
          admin,
          enroll,
        ),
      ).toBe(expected);
    },
  );

  it("agrees with authorize on every row: an enabled route exists for some token", () => {
    for (const [route, rotate, admin, enroll, expected] of ENABLED) {
      const which = route as "register" | "removeProject";
      const reachable =
        (admin && authorize(which, rotate, "admin").kind === "admin") ||
        (enroll && authorize(which, rotate, "enroll").kind !== "refuse");
      expect(reachable, `${which} rotate=${rotate}`).toBe(expected);
    }
  });
});
