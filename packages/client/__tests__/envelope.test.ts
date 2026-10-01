import { describe, expect, it } from "vitest";

import {
  applyTails,
  buildEnvelope,
  formatTimestamp,
  lanesOf,
} from "../src/domain/envelope.js";
import { TAIL_BYTES } from "../src/domain/tail.js";
import {
  GENERATED_AT,
  laneWithTail,
  laneWithoutTail,
} from "./support/harness.js";

const context = {
  project: "waves-demo",
  wave: "wv5",
  generatedAt: GENERATED_AT,
  intervalSeconds: null,
  includeTails: false,
};

describe("formatTimestamp", () => {
  it("writes the strict ISO-8601 UTC form the contract accepts", () => {
    expect(formatTimestamp(Date.parse("2026-02-03T04:05:06.789Z"))).toBe(
      "2026-02-03T04:05:06.789Z",
    );
    expect(formatTimestamp(0)).toBe("1970-01-01T00:00:00.000Z");
  });
});

describe("lanesOf", () => {
  it("takes the lanes of an envelope or of a bare status", () => {
    expect(lanesOf({ lanes: [1, 2] })).toEqual([1, 2]);
    expect(lanesOf({ schema: "waves/v1", lanes: [] })).toEqual([]);
  });

  it("refuses anything that is not a status for one wave", () => {
    expect(lanesOf([])).toBeUndefined();
    expect(lanesOf("lanes")).toBeUndefined();
    expect(lanesOf(null)).toBeUndefined();
    expect(lanesOf({ lanes: "none" })).toBeUndefined();
  });
});

describe("applyTails", () => {
  it("deletes every tail unless tails were asked for", () => {
    const lanes = [laneWithTail("noisy\n"), { id: "plain" }, "not a lane"];
    expect(applyTails(lanes, false)).toEqual([
      laneWithoutTail(),
      { id: "plain" },
      "not a lane",
    ]);
  });

  it("truncates every tail to the last 4096 bytes when tails were asked for", () => {
    const tail = "x".repeat(TAIL_BYTES + 10);
    expect(applyTails([laneWithTail(tail)], true)).toEqual([
      laneWithTail("x".repeat(TAIL_BYTES)),
    ]);
  });

  it("leaves lanes without a tail exactly as they are", () => {
    const lane = { id: "wv5", derived: { alive: true } };
    expect(applyTails([lane], false)).toEqual([lane]);
    expect(applyTails([lane], true)).toEqual([lane]);
  });

  it("never touches the value it was given", () => {
    const lane = laneWithTail("noisy\n");
    const lanes = [lane];
    applyTails(lanes, false);
    expect(lanes[0]).toEqual(laneWithTail("noisy\n"));
  });

  it("copes with a lane, a derived and a log that are not there", () => {
    const lanes = [
      { id: "wv5" },
      { id: "wv5", derived: "alive" },
      { id: "wv5", derived: { log: "noisy" } },
      { id: "wv5", derived: { log: { bytes: 1, mtimeMs: 2, tail: 7 } } },
    ];
    expect(applyTails(lanes, true)).toEqual(lanes);
    expect(applyTails(lanes, false)).toEqual(lanes);
  });
});

describe("buildEnvelope", () => {
  it("wraps the lanes in an envelope the client owns", () => {
    expect(buildEnvelope([laneWithTail("noisy\n")], context)).toEqual({
      schema: "waves/v1",
      project: "waves-demo",
      wave: "wv5",
      generatedAt: GENERATED_AT,
      intervalSeconds: null,
      lanes: [laneWithoutTail()],
    });
  });

  it("keeps the interval and the tails the run asked for", () => {
    expect(
      buildEnvelope([laneWithTail("x".repeat(TAIL_BYTES + 1))], {
        ...context,
        intervalSeconds: 60,
        includeTails: true,
      }),
    ).toEqual({
      schema: "waves/v1",
      project: "waves-demo",
      wave: "wv5",
      generatedAt: GENERATED_AT,
      intervalSeconds: 60,
      lanes: [laneWithTail("x".repeat(TAIL_BYTES))],
    });
  });

  it("leaves an empty wave empty", () => {
    expect(buildEnvelope([], context).lanes).toEqual([]);
  });
});
