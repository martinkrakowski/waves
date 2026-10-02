import { describe, expect, it } from "vitest";

import type { ViewQuery } from "../../public/query.js";
import { formatQuery, parseQuery } from "../../public/query.js";

const EMPTY: ViewQuery = { all: false };

function parsed(search: string): ViewQuery {
  return parseQuery(search);
}

describe("parseQuery", () => {
  it("takes every parameter that passes its rule", () => {
    expect(
      parsed("?reason=gate&stage=plan-review&seat=s1&q=fix&lane=wv-a&all=1"),
    ).toStrictEqual({
      reason: "gate",
      stage: "plan-review",
      seat: "s1",
      q: "fix",
      lane: "wv-a",
      all: true,
    });
  });

  it("reads no query string as no query at all", () => {
    expect(parsed("")).toStrictEqual(EMPTY);
    expect(parsed("?")).toStrictEqual(EMPTY);
    expect(parsed("?&")).toStrictEqual(EMPTY);
  });

  it("takes a reason only from the six the server knows", () => {
    for (const reason of [
      "failed",
      "disagreement",
      "checks",
      "gate",
      "exit",
      "silent",
    ] as const) {
      expect(parsed(`?reason=${reason}`).reason).toBe(reason);
    }
    expect(parsed("?reason=Gate").reason).toBeUndefined();
    expect(parsed("?reason=").reason).toBeUndefined();
    expect(parsed("?reason=merged").reason).toBeUndefined();
  });

  it("takes a stage only in the contract's shape", () => {
    expect(parsed("?stage=a").stage).toBe("a");
    expect(parsed(`?stage=${"a".repeat(32)}`).stage).toBe("a".repeat(32));
    expect(parsed(`?stage=${"a".repeat(33)}`).stage).toBeUndefined();
    expect(parsed("?stage=1plan").stage).toBeUndefined();
    expect(parsed("?stage=Plan").stage).toBeUndefined();
    expect(parsed("?stage=plan_review").stage).toBeUndefined();
    expect(parsed("?stage=-plan").stage).toBeUndefined();
    expect(parsed("?stage=").stage).toBeUndefined();
  });

  it("takes a seat up to 128 printable characters, and no further", () => {
    expect(parsed(`?seat=${"s".repeat(128)}`).seat).toBe("s".repeat(128));
    expect(parsed(`?seat=${"s".repeat(129)}`).seat).toBeUndefined();
    expect(parsed("?seat=one%20two%20%26%20three").seat).toBe(
      "one two & three",
    );
    expect(parsed("?seat=caf%C3%A9").seat).toBe("café");
    expect(parsed("?seat=one%09two").seat).toBeUndefined();
    expect(parsed("?seat=one%0Atwo").seat).toBeUndefined();
    expect(parsed("?seat=one%7Ftwo").seat).toBeUndefined();
    expect(parsed("?seat=").seat).toBeUndefined();
  });

  it("takes a search up to 80 printable characters, and no further", () => {
    expect(parsed(`?q=${"x".repeat(80)}`).q).toBe("x".repeat(80));
    expect(parsed(`?q=${"x".repeat(81)}`).q).toBeUndefined();
    expect(parsed("?q=%23%26%3D%25").q).toBe("#&=%");
    expect(parsed("?q=%E2%98%83").q).toBe("☃");
    expect(parsed("?q=one%0Dtwo").q).toBeUndefined();
    expect(parsed("?q=").q).toBeUndefined();
  });

  it("takes a lane only in the pusher's id shape", () => {
    expect(parsed("?lane=w-1").lane).toBe("w-1");
    expect(parsed("?lane=W_v1").lane).toBe("W_v1");
    expect(parsed(`?lane=${"a".repeat(80)}`).lane).toBe("a".repeat(80));
    expect(parsed(`?lane=${"a".repeat(81)}`).lane).toBeUndefined();
    expect(parsed("?lane=_wv").lane).toBeUndefined();
    expect(parsed("?lane=wv%2F1").lane).toBeUndefined();
    expect(parsed("?lane=").lane).toBeUndefined();
  });

  it("ignores a parameter it does not know, and a malformed search", () => {
    expect(parsed("?page=2&reason=exit")).toStrictEqual({
      reason: "exit",
      all: false,
    });
    expect(parsed("?%")).toStrictEqual(EMPTY);
    expect(parsed("?a=%E0%A4%A")).toStrictEqual(EMPTY);
  });

  it("takes the first value when a parameter repeats", () => {
    expect(parsed("?reason=exit&reason=gate").reason).toBe("exit");
    expect(parsed("?seat=s1&seat=s2").seat).toBe("s1");
    expect(parsed("?all=1&all=0").all).toBe(true);
    expect(parsed("?all=0&all=1").all).toBe(false);
  });

  it("reads all as true only for all=1", () => {
    expect(parsed("?all=1").all).toBe(true);
    expect(parsed("?all=0").all).toBe(false);
    expect(parsed("?all=true").all).toBe(false);
    expect(parsed("?all=").all).toBe(false);
    expect(parsed("?all=11").all).toBe(false);
    expect(parsed("?all=on").all).toBe(false);
  });
});

describe("formatQuery", () => {
  it("writes nothing for a view that asks for nothing", () => {
    expect(formatQuery(EMPTY)).toBe("");
    expect(formatQuery({ ...EMPTY, all: false })).toBe("");
  });

  it("writes the keys in one order, whatever order they arrived in", () => {
    expect(
      formatQuery({
        lane: "wv-a",
        q: "fix",
        seat: "s1",
        stage: "plan",
        reason: "gate",
        all: true,
      }),
    ).toBe("?reason=gate&stage=plan&seat=s1&q=fix&lane=wv-a&all=1");
  });

  it("writes only the keys that are there, and all only when it is true", () => {
    expect(formatQuery({ stage: "plan", all: true })).toBe("?stage=plan&all=1");
    expect(formatQuery({ stage: "plan", all: false })).toBe("?stage=plan");
  });

  it("encodes every value, so a value cannot carry a parameter of its own", () => {
    expect(formatQuery({ seat: "a b&c=d#e%ü", all: false })).toBe(
      "?seat=a+b%26c%3Dd%23e%25%C3%BC",
    );
  });
});

describe("the round trip", () => {
  const TABLE: readonly ViewQuery[] = [
    EMPTY,
    { all: true },
    { reason: "failed", all: false },
    { reason: "silent", all: true },
    { stage: "plan-review", all: false },
    { seat: "seat one", all: false },
    { seat: "a&b=c", all: false },
    { seat: "a#b", all: true },
    { seat: "100%", all: false },
    { seat: "café ☃", all: false },
    { q: "a & b = c", all: true },
    { q: "#hash", all: false },
    { lane: "W_v-1", all: false },
    {
      reason: "disagreement",
      stage: "plan",
      seat: "seat one & two",
      q: "gate fail",
      lane: "wv-a",
      all: true,
    },
  ];

  it("reads back exactly what it wrote", () => {
    for (const query of TABLE) {
      expect(parseQuery(formatQuery(query))).toStrictEqual(query);
    }
  });
});
