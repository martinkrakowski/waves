import { describe, expect, it } from "vitest";

import type {
  RunOutcome,
  RunRequest,
  TransportOptions,
} from "../src/application/ports.js";
import { sync } from "../src/application/sync.js";
import { harness, reply } from "./support/harness.js";
import {
  entry,
  exited,
  handClock,
  printed,
  syncFile,
  SYNC_FILE,
  tokenFiles,
} from "./support/sync.js";

const ACCEPTED = `{"receivedAt":"2026-02-03T04:05:07.001Z"}`;
const PROJECTS = ["alpha", "beta", "gamma"];

/**
 * A run whose clock only moves when something happens: a collector costs what the
 * test says it costs, and so does a write. This is the only way to ask what a
 * tick does when it runs out — the real clock in a test never runs out.
 */
function ticking(input: {
  readonly file: string;
  readonly answers: readonly RunOutcome[];
  /** What each collector costs, and what each write costs. */
  readonly collectMs?: number;
  readonly sendMs?: number;
  readonly replies?: number;
}) {
  const time = handClock();
  const built = harness({
    script: Array.from({ length: input.replies ?? 8 }, () =>
      reply(200, ACCEPTED),
    ),
    files: {
      [SYNC_FILE]: { text: input.file, mode: 0o600 },
      ...tokenFiles(...PROJECTS),
    },
    clock: time.clock,
  });
  let answered = 0;
  const asked: RunRequest[] = [];
  const started = built.deps.transport;
  const deps = {
    ...built.deps,
    runner: {
      run: async (request: RunRequest): Promise<RunOutcome> => {
        asked.push(request);
        time.pass(input.collectMs ?? 0);
        const answer = input.answers[answered];
        answered += 1;
        if (answer === undefined) {
          throw new Error(
            "the test scripted fewer collectors than the run asked for",
          );
        }
        return answer;
      },
    },
    transport: (options: TransportOptions) => {
      const inner = started(options);
      return {
        send: async (request: Parameters<typeof inner.send>[0]) => {
          time.pass(input.sendMs ?? 0);
          return await inner.send(request);
        },
      };
    },
  };
  return { built, deps, time, asked };
}

const ALL = PROJECTS.map((project) => entry(project));

describe("where a run starts", () => {
  it("follows the clock, so two ticks of one schedule start in different places", async () => {
    const at = async (
      now: number,
    ): Promise<readonly (string | undefined)[]> => {
      const time = handClock(now);
      const built = harness({
        script: Array.from({ length: 8 }, () => reply(200, ACCEPTED)),
        runs: [
          exited(printed(["wv5"])),
          exited(printed(["wv5"])),
          exited(printed(["wv5"])),
        ],
        files: {
          [SYNC_FILE]: { text: syncFile(ALL, { every: 60 }), mode: 0o600 },
          ...tokenFiles(...PROJECTS),
        },
        clock: time.clock,
      });

      expect(await sync(built.deps)).toBe(0);
      return built.runs.map((request) => request.env["WAVES_PROJECT"]);
    };

    // The index is floor(now / every) mod n, and it wraps round at the end.
    expect(await at(0)).toEqual(PROJECTS);
    expect(await at(59_999)).toEqual(PROJECTS);
    expect(await at(60_000)).toEqual(["beta", "gamma", "alpha"]);
    expect(await at(130_000)).toEqual(["gamma", "alpha", "beta"]);
    expect(await at(180_000)).toEqual(PROJECTS);
  });
});

describe("one budget of every seconds for the whole run", () => {
  it("gives a collector what is left of it, never more than its own deadline", async () => {
    const { built, deps, asked } = ticking({
      file: syncFile([entry("alpha"), entry("beta")], { every: 60 }),
      answers: [exited(printed(["wv5"])), exited(printed(["wv5"]))],
      collectMs: 45_000,
    });

    expect(await sync(deps)).toBe(1);
    // Twenty seconds is the default deadline and the whole period is sixty, so the
    // first collector gets twenty; the second has fifteen seconds of the period
    // left and is given those instead.
    expect(asked.map((request) => request.timeoutMs)).toEqual([20000, 15000]);
    // Which is also where the tick ended: the second collector's waves do not go.
    expect(built.out).toEqual(["waves sync: alpha: 1 waves"]);
    expect(built.err).toEqual(["waves sync: beta: out of time after 0 waves"]);
  });

  it("stops sending a project's waves once the budget is spent", async () => {
    const { built, deps } = ticking({
      file: syncFile([entry("alpha")], { every: 60 }),
      answers: [exited(printed(["wv5", "wv9", "wv7"]), {})],
      collectMs: 30_000,
      sendMs: 31_000,
      replies: 3,
    });

    expect(await sync(deps)).toBe(1);
    expect(built.err).toEqual(["waves sync: alpha: out of time after 1 waves"]);
    expect(built.out).toEqual([]);
    expect(built.requests).toHaveLength(1);
  });

  it("sends the status out of the same budget as the waves", async () => {
    const { built, deps } = ticking({
      file: syncFile([entry("alpha")], { every: 60 }),
      answers: [exited(printed(["wv5"], { prs: { skipped: 1 } }))],
      collectMs: 0,
      sendMs: 61_000,
      replies: 1,
    });

    expect(await sync(deps)).toBe(1);
    expect(built.err).toEqual(["waves sync: alpha: out of time after 1 waves"]);
    expect(built.requests).toHaveLength(1);
  });

  it("skips every project it has not started, and fails the run for them", async () => {
    const { built, deps, asked } = ticking({
      file: syncFile(ALL, { every: 10 }),
      answers: [
        exited(printed(["wv5"])),
        exited(printed(["wv5"])),
        exited(printed(["wv5"])),
      ],
      collectMs: 6000,
      sendMs: 5000,
      replies: 2,
    });

    expect(await sync(deps)).toBe(1);
    // One project fitted inside the ten seconds and its write took it to eleven,
    // so the other two never started: a line each, and an exit code of 1, because
    // a project that was not pushed is not a successful tick.
    expect(built.out).toEqual(["waves sync: alpha: 1 waves"]);
    expect(built.err).toEqual([
      "waves sync: beta: skipped, out of time",
      "waves sync: gamma: skipped, out of time",
    ]);
    expect(asked).toHaveLength(1);
  });

  it("starts the first project whatever the clock says, because the budget begins here", async () => {
    // The rotation can begin the run at the end of its own period, but the budget
    // is measured from the moment the run starts, so the first project always has
    // a whole period to spend.
    const time = handClock(60_000);
    const built = harness({
      script: [
        reply(200, ACCEPTED),
        reply(200, ACCEPTED),
        reply(200, ACCEPTED),
      ],
      runs: [
        exited(printed(["wv5"])),
        exited(printed(["wv5"])),
        exited(printed(["wv5"])),
      ],
      files: {
        [SYNC_FILE]: { text: syncFile(ALL, { every: 60 }), mode: 0o600 },
        ...tokenFiles(...PROJECTS),
      },
      clock: time.clock,
    });

    expect(await sync(built.deps)).toBe(0);
    expect(built.out).toEqual([
      "waves sync: beta: 1 waves",
      "waves sync: gamma: 1 waves",
      "waves sync: alpha: 1 waves",
    ]);
  });
});
