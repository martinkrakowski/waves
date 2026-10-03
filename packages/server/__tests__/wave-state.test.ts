import { describe, expect, it } from "vitest";

import { waveState, type WaveStateLane } from "../src/domain/wave-state.js";

/** A lane with nothing on it but liveness, the state of the least said lane. */
function lane(overrides: Partial<WaveStateLane> = {}): WaveStateLane {
  return { alive: false, ...overrides };
}

/** A lane that is working and has said nothing else. */
const working: WaveStateLane = { alive: true };

/** A lane that has finished, cleanly, and opened a pull request. */
function merged(state: "merged" | "closed" = "merged"): WaveStateLane {
  return { alive: false, exit: 0, prState: state };
}

describe("waveState", () => {
  it.each([
    // Nothing at all is `settled`: not `done`, which says an answer was asked
    // for, and not `failed`, which says a lane asked and was not answered.
    ["no lanes at all", [], false, "settled"],
    // One lane, four ways a reader could describe it.
    [
      "a lane that failed and is not running",
      [lane({ event: "failed" })],
      false,
      "failed",
    ],
    [
      "a lane that exited non-zero and is not running",
      [lane({ exit: 1 })],
      false,
      "failed",
    ],
    [
      "a lane that settled cleanly",
      [lane({ exit: 0, event: "settled" })],
      false,
      "settled",
    ],
    ["a lane that is being worked on", [working], false, "running"],
  ] satisfies [string, WaveStateLane[], boolean, string][])(
    "calls %s %s",
    (_what, lanes, stale, expected) => {
      expect(waveState(lanes, stale)).toBe(expected);
    },
  );

  it("calls a wave whose pull requests have all been answered done", () => {
    expect(waveState([merged(), lane({ prState: "open" })], false)).toBe(
      "settled",
    );
    expect(waveState([merged()], false)).toBe("done");
    expect(waveState([merged("closed")], false)).toBe("done");
    expect(waveState([merged(), merged("closed")], false)).toBe("done");
  });

  it("calls a lane whose exit is zero or missing settled, not failed", () => {
    expect(waveState([lane({ exit: 0 })], false)).toBe("settled");
    expect(waveState([lane({ event: "settled" })], false)).toBe("settled");
    expect(waveState([lane({ event: "started" })], false)).toBe("settled");
    expect(waveState([lane({ event: "started", exit: 2 })], false)).toBe(
      "failed",
    );
  });

  it("does not call an answered lane failed, whatever it left behind", () => {
    // A pull request that merged and a non-zero exit is a lane whose work was
    // finished by something other than its last exit: the question it raised is
    // answered and its stale data cannot contradict the answer.
    expect(waveState([merged()], false)).toBe("done");
    expect(
      waveState([lane({ exit: 1, event: "failed", prState: "merged" })], false),
    ).toBe("done");
    expect(
      waveState([lane({ exit: 1, event: "failed", prState: "closed" })], false),
    ).toBe("done");
  });

  it("does not call a lane that is still alive failed", () => {
    // `attentionReasons` raises `failed` for an alive lane that reported it;
    // here a lane that is still up has not finished failing.
    expect(waveState([lane({ alive: true, event: "failed" })], false)).toBe(
      "running",
    );
    expect(
      waveState([lane({ alive: true, exit: 1, event: "failed" })], false),
    ).toBe("running");
  });

  it("calls a lane of a stale wave settled however alive it is", () => {
    expect(waveState([working], true)).toBe("settled");
    expect(waveState([working, merged()], true)).toBe("settled");
    expect(waveState([merged(), working], true)).toBe("settled");
  });

  it("takes the first state in its order, not the first lane that matches", () => {
    // A wave that has a failing lane and a running one is `failed`: the order
    // is the rule, and nothing about the second lane reopens it.
    expect(waveState([lane({ exit: 1 }), working, merged()], false)).toBe(
      "failed",
    );
    // And `done` outranks `running`, so a wave whose pull requests are all
    // answered is done even while one of its lanes is still marked alive: the
    // liveness of a lane whose question is answered is not the wave's state.
    const aliveMerged: WaveStateLane = { alive: true, prState: "merged" };
    expect(waveState([merged(), aliveMerged], false)).toBe("done");
    expect(waveState([aliveMerged, merged()], false)).toBe("done");
  });
});
