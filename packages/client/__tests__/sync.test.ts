import { describe, expect, it } from "vitest";

import { run as entrypoint } from "../src/application/entrypoint.js";
import {
  FileRefusal,
  type CliDeps,
  type RunOutcome,
} from "../src/application/ports.js";
import type { CliIo } from "../src/application/entrypoint.js";
import { sync } from "../src/application/sync.js";
import { harness, laneWithTail, reply } from "./support/harness.js";
import {
  COLLECTOR,
  COLLECTOR_DIR,
  entry,
  exited,
  printed,
  syncFile,
  SYNC_FILE,
  tokenFiles,
  tokenPathOf,
} from "./support/sync.js";

const DEMO = "waves-demo";
const PORTAL = "client-portal";
const OTHER = "someone-else";
const ACCEPTED = `{"receivedAt":"2026-02-03T04:05:07.001Z"}`;
const WAVES = "http://127.0.0.1:8080/api/v1/projects";

/** What a collector is given, and what this client's own environment holds. */
const GIVEN = { PATH: "/usr/bin", HOME: "/home/waves", LANG: "en_GB.UTF-8" };

/**
 * A run over a `sync.json`, with these collector answers and so many 200s.
 *
 * The clock starts at zero on purpose: a run begins at index
 * `floor(now / every) mod n` of the file, and a test that wants the file's own
 * order has to start somewhere that index 0 is.
 */
function run(input: {
  readonly file?: string;
  readonly runs?: readonly RunOutcome[];
  readonly script?: readonly ReturnType<typeof reply>[];
  readonly tokens?: readonly string[];
  readonly vars?: Readonly<Record<string, string | undefined>>;
}) {
  const built = harness({
    script: input.script ?? [
      ...Array.from({ length: 8 }, () => reply(200, ACCEPTED)),
    ],
    runs: input.runs ?? [],
    files: {
      ...(input.file === undefined
        ? {}
        : { [SYNC_FILE]: { text: input.file, mode: 0o600 } }),
      ...tokenFiles(...(input.tokens ?? [DEMO, PORTAL])),
    },
    vars: { WAVES_PROJECT: OTHER, ...GIVEN, ...input.vars },
    now: 0,
  });
  return built;
}

describe("a run over two projects that both worked", () => {
  it("sends every wave, then the status, and says what it sent", async () => {
    const built = run({
      file: syncFile([entry(DEMO), entry(PORTAL)]),
      runs: [
        exited(printed(["wv5", "wv9"], { prs: { skipped: 2 } })),
        exited(printed(["wv7"])),
      ],
    });

    expect(await sync(built.deps)).toBe(0);
    expect(built.out).toEqual([
      "waves sync: waves-demo: 2 waves, status",
      "waves sync: client-portal: 1 waves",
    ]);
    expect(built.err).toEqual([]);
    expect(built.requests.map((request) => request.url)).toEqual([
      `${WAVES}/${DEMO}/waves/wv5`,
      `${WAVES}/${DEMO}/waves/wv9`,
      `${WAVES}/${DEMO}/status`,
      `${WAVES}/${PORTAL}/waves/wv7`,
    ]);
  });

  it("sends the period as the interval of every wave and of the status", async () => {
    const built = run({
      file: syncFile([entry(DEMO)], { every: 30 }),
      runs: [
        exited(printed(["wv5", "wv9"], { backlog: { state: "recorded" } })),
      ],
    });

    expect(await sync(built.deps)).toBe(0);
    for (const request of built.requests) {
      expect(JSON.parse(request.body ?? "{}")["intervalSeconds"]).toBe(30);
    }
    // Half the period is the cap on one collector, and the default sits under it.
    expect(built.runs[0]?.timeoutMs).toBe(15000);
  });

  it("drops the tails in a lane, exactly as a push does", async () => {
    const built = run({
      file: syncFile([entry(DEMO)]),
      runs: [
        exited(
          JSON.stringify({
            waves: [{ wave: "wv5", lanes: [laneWithTail("noisy\n")] }],
          }),
        ),
      ],
    });

    expect(await sync(built.deps)).toBe(0);
    expect(built.requests).toHaveLength(1);
    expect(built.requests[0]?.body).not.toContain("noisy");
  });

  it("says nothing for a project that reported no waves", async () => {
    const built = run({
      file: syncFile([entry(DEMO)]),
      runs: [exited(printed([]))],
      script: [],
    });

    expect(await sync(built.deps)).toBe(0);
    expect(built.out).toEqual(["waves sync: waves-demo: 0 waves"]);
    expect(built.requests).toEqual([]);
  });
});

describe("the environment a collector is given", () => {
  it("is PATH, HOME, LANG and its own project, and nothing of ours", async () => {
    const built = run({
      file: syncFile([entry(DEMO)]),
      runs: [exited(printed(["wv5"]))],
    });

    expect(await sync(built.deps)).toBe(0);
    expect(built.runs[0]).toEqual({
      command: [COLLECTOR],
      cwd: COLLECTOR_DIR,
      env: { ...GIVEN, WAVES_PROJECT: DEMO },
      timeoutMs: 20000,
    });
    // The client's own WAVES_PROJECT names whoever ran the command, which under a
    // scheduler is nobody; the collector is told which project it collects.
    expect(built.runs[0]?.env["WAVES_PROJECT"]).not.toBe(OTHER);
  });

  it("leaves out the names this client does not have itself", async () => {
    const built = run({
      file: syncFile([entry(DEMO)]),
      runs: [exited(printed(["wv5"]))],
      vars: { HOME: undefined, LANG: undefined },
      tokens: [DEMO],
    });

    expect(await sync(built.deps)).toBe(0);
    expect(built.runs[0]?.env).toEqual({
      PATH: "/usr/bin",
      WAVES_PROJECT: DEMO,
    });
  });
});

describe("a collector that failed", () => {
  const failures: readonly {
    readonly name: string;
    readonly outcome: RunOutcome;
    readonly line: string;
  }[] = [
    {
      name: "exits non-zero",
      outcome: exited(printed(["wv5"]), { code: 3, stderr: "boom\n" }),
      line: "waves sync: waves-demo: the collector exited 3: boom",
    },
    {
      name: "is killed by a signal",
      outcome: exited(printed(["wv5"]), { code: null }),
      line: "waves sync: waves-demo: the collector was killed by a signal",
    },
    {
      name: "runs out of time",
      outcome: { kind: "timeout" },
      line: "waves sync: waves-demo: the collector ran out of time",
    },
    {
      name: "prints more than this client reads",
      outcome: { kind: "overflow" },
      line: "waves sync: waves-demo: the collector printed more on stdout than this client reads",
    },
    {
      name: "cannot be started",
      outcome: { kind: "spawn-error", message: "spawn ENOENT" },
      line: "waves sync: waves-demo: the collector could not be started: spawn ENOENT",
    },
    {
      name: "prints something that is not JSON",
      outcome: exited("not json"),
      line: "waves sync: waves-demo: the collector printed something that is not JSON",
    },
    {
      name: "prints a shape this client does not read",
      outcome: exited('{"waves":{}}'),
      line: "waves sync: waves-demo: the collector printed no waves array",
    },
    {
      name: "prints more waves than the cap",
      outcome: exited(
        printed(Array.from({ length: 33 }, (_, at) => `wv${at}`)),
      ),
      line: "waves sync: waves-demo: the collector printed 33 waves; at most 32 are read",
    },
    {
      name: "prints the same wave twice",
      outcome: exited(printed(["wv5", "wv5"])),
      line: "waves sync: waves-demo: the collector printed wave wv5 twice",
    },
  ];

  for (const failure of failures) {
    it(`${failure.name}: pushes nothing, and the next project still runs`, async () => {
      const built = run({
        file: syncFile([entry(DEMO), entry(PORTAL)]),
        runs: [failure.outcome, exited(printed(["wv7"]))],
        script: [reply(200, ACCEPTED)],
      });

      expect(await sync(built.deps)).toBe(1);
      expect(built.err).toEqual([failure.line]);
      expect(built.out).toEqual(["waves sync: client-portal: 1 waves"]);
      // The only request that went out was the second project's own wave.
      expect(built.requests).toHaveLength(1);
      expect(built.requests[0]?.url).toContain(PORTAL);
    });
  }

  it("quotes its stderr as one cut line, and says when it was cut short", async () => {
    const noisy = `first line\n\u001b[31msecond\u001b[m\n${"x".repeat(400)}\n`;
    const built = run({
      file: syncFile([entry(DEMO)]),
      runs: [exited("", { code: 1, stderr: noisy, stderrTruncated: true })],
      script: [],
    });

    expect(await sync(built.deps)).toBe(1);
    // The escape sequence and the two line ends are gone, the note is 200
    // characters at most, and it is one line because a log line has to be one.
    expect(built.err).toEqual([
      `waves sync: waves-demo: the collector exited 1: first line second ${"x".repeat(
        181,
      )}… (its stderr was cut short)`,
    ]);
  });

  it("says nothing extra when a collector failed quietly", async () => {
    const built = run({
      file: syncFile([entry(DEMO)]),
      runs: [exited("", { code: 1, stderr: "   \n" })],
      script: [],
    });

    expect(await sync(built.deps)).toBe(1);
    expect(built.err).toEqual([
      "waves sync: waves-demo: the collector exited 1",
    ]);
  });
});

describe("a project whose token cannot be read", () => {
  it("fails on its own, and the next project still runs", async () => {
    const built = run({
      file: syncFile([entry(DEMO), entry(PORTAL)]),
      runs: [exited(printed(["wv5"])), exited(printed(["wv7"]))],
      script: [reply(200, ACCEPTED)],
      tokens: [PORTAL],
    });

    expect(await sync(built.deps)).toBe(1);
    expect(built.err).toEqual([
      `waves sync: waves-demo: no token for waves-demo at ${tokenPathOf(DEMO)}; run waves register first`,
    ]);
    expect(built.out).toEqual(["waves sync: client-portal: 1 waves"]);
    expect(built.requests).toHaveLength(1);
  });

  it("fails on its own when the file is one the adapter would not open", async () => {
    const built = run({
      file: syncFile([entry(DEMO), entry(PORTAL)]),
      runs: [exited(printed(["wv5"])), exited(printed(["wv7"]))],
      script: [reply(200, ACCEPTED)],
    });
    const refusal = new FileRefusal(
      `${tokenPathOf(DEMO)} is mode 0o644; it must be 0600 or stricter`,
    );
    const deps = {
      ...built.deps,
      files: {
        ...built.deps.files,
        readSecret: async (path: string, name?: string) => {
          if (path === tokenPathOf(DEMO)) {
            throw refusal;
          }
          return await built.deps.files.readSecret(path, name);
        },
      },
    };

    expect(await sync(deps)).toBe(1);
    expect(built.err).toEqual([`waves sync: waves-demo: ${refusal.message}`]);
    expect(built.out).toEqual(["waves sync: client-portal: 1 waves"]);
    expect(built.requests).toHaveLength(1);
  });
});

describe("a wave the contract will not take", () => {
  it("is that wave's line, and the other waves still go", async () => {
    const built = run({
      file: syncFile([entry(DEMO)]),
      runs: [
        exited(
          JSON.stringify({
            waves: [
              { wave: "wv5", lanes: [{ id: "wv5" }] },
              { wave: "wv9", lanes: [] },
              { wave: "wv7", lanes: [] },
            ],
          }),
        ),
      ],
      script: [reply(200, ACCEPTED), reply(200, ACCEPTED)],
    });

    expect(await sync(built.deps)).toBe(1);
    expect(built.err).toEqual([
      `waves sync: waves-demo: wv5: the envelope is not valid:\n  /lanes/0/derived: expected an object\n  /lanes/0/disagreements: expected an array`,
    ]);
    expect(built.out).toEqual(["waves sync: waves-demo: 2 waves"]);
    expect(built.requests.map((request) => request.url)).toEqual([
      `${WAVES}/${DEMO}/waves/wv9`,
      `${WAVES}/${DEMO}/waves/wv7`,
    ]);
  });
});

describe("the pacing of one project's writes", () => {
  it("waits a second between two waves", async () => {
    const built = run({
      file: syncFile([entry(DEMO)]),
      runs: [exited(printed(["wv5", "wv9", "wv7"]))],
      script: [
        reply(200, ACCEPTED),
        reply(200, ACCEPTED),
        reply(200, ACCEPTED),
      ],
    });

    expect(await sync(built.deps)).toBe(0);
    expect(built.waits).toEqual([1000, 1000]);
  });

  it("waits a second before a retry the server asked for no wait on", async () => {
    const built = run({
      file: syncFile([entry(DEMO)]),
      runs: [exited(printed(["wv5", "wv9"]))],
      script: [
        reply(429, "", { "retry-after": "0" }),
        reply(200, ACCEPTED),
        reply(200, ACCEPTED),
      ],
    });

    expect(await sync(built.deps)).toBe(0);
    // The retry policy's own wait for a Retry-After of 0, then the pace before the
    // retry, then the pace before the next wave. Without the pace the two 1000s
    // would not be there at all.
    expect(built.waits).toEqual([0, 1000, 1000]);
    expect(built.sent()).toBe(3);
  });

  it("waits again when a throttled wave is retried and then a second wave goes", async () => {
    const built = run({
      file: syncFile([entry(DEMO)]),
      runs: [exited(printed(["wv5", "wv9"]))],
      script: [
        reply(429, "", { "retry-after": "1" }),
        reply(200, ACCEPTED),
        reply(200, ACCEPTED),
      ],
    });

    expect(await sync(built.deps)).toBe(0);
    // The retry's own second, then the pace before the retry, then the pace before
    // the next wave: a retry the server named and the pace are both waits.
    expect(built.waits).toEqual([1000, 1000, 1000]);
  });

  it("paces nothing between two projects", async () => {
    const built = run({
      file: syncFile([entry(DEMO), entry(PORTAL)]),
      runs: [exited(printed(["wv5"])), exited(printed(["wv7"]))],
      script: [reply(200, ACCEPTED), reply(200, ACCEPTED)],
    });

    expect(await sync(built.deps)).toBe(0);
    // One pace per project, so the second project's first write is not made to
    // wait for the first project's last one.
    expect(built.waits).toEqual([]);
  });
});

describe("a configuration the run cannot use", () => {
  it("is exit 2 with nothing started at all", async () => {
    const missing = harness({ files: tokenFiles(DEMO), now: 0 });

    // Through the entrypoint, which is where a refusal becomes an exit code and
    // where the command's own name is put in front of it.
    expect(await cli(missing)).toBe(2);
    expect(missing.err).toEqual([
      "waves sync: no sync.json in /home/waves/.config/waves",
    ]);
    expect(missing.runs).toEqual([]);

    const broken = run({ file: syncFile([entry(DEMO)], { every: 101 }) });
    expect(await cli(broken)).toBe(2);
    expect(broken.err).toEqual([
      "waves sync: every must be between 10 and 100 seconds",
    ]);
    expect(broken.runs).toEqual([]);
    expect(broken.requests).toEqual([]);
  });

  it("is exit 2 when a collector's deadline is more than half the period", async () => {
    const built = run({
      file: syncFile([entry(DEMO, { timeoutSeconds: 16 })], { every: 30 }),
    });

    expect(await cli(built)).toBe(2);
    expect(built.err).toEqual([
      "waves sync: project 0: timeoutSeconds must be at most half of every (15)",
    ]);
    expect(built.runs).toEqual([]);
  });
  it("lets anything that is not a refusal travel out, because it is a bug", async () => {
    // The runner here has no answers scripted, so it throws something that is not
    // one of the three refusals a run turns into a line.
    const built = run({ file: syncFile([entry(DEMO)]) });

    await expect(sync(built.deps)).rejects.toThrow(
      "the fake runner ran out of answers",
    );
    expect(built.err).toEqual([]);
  });
});

/** One command through the entrypoint, which is what a shell actually runs. */
function cli(built: {
  readonly io: CliIo;
  readonly deps: CliDeps;
}): Promise<number> {
  return entrypoint(["sync"], built.io, built.deps);
}
