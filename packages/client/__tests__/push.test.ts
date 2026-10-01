import { describe, expect, it } from "vitest";

import type { Command } from "../src/domain/args.js";
import { push } from "../src/application/push.js";
import { TAIL_BYTES } from "../src/domain/tail.js";
import {
  CONFIG_DIR,
  GENERATED_AT,
  PROJECT,
  PROJECT_TOKEN,
  WAVE,
  harness,
  laneWithTail,
  lanesOnly,
  network,
  reply,
} from "./support/harness.js";

type PushCommand = Extract<Command, { readonly kind: "push" }>;

const tokenPath = `${CONFIG_DIR}/${PROJECT}.token`;

const ACCEPTED = `{"receivedAt":"2026-02-03T04:05:07.001Z"}`;

function command(overrides: Partial<PushCommand> = {}): PushCommand {
  return {
    kind: "push",
    wave: WAVE,
    source: { kind: "stdin" },
    intervalSeconds: null,
    includeTails: false,
    ...overrides,
  };
}

describe("push", () => {
  it("sends an envelope the contract normalised, and reports when it landed", async () => {
    const built = harness({
      script: [reply(200, ACCEPTED)],
      stdin: lanesOnly("noisy\n"),
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });

    expect(await push(command(), built.deps)).toBe(0);
    expect(built.out).toEqual([
      `pushed ${PROJECT}/${WAVE} at 2026-02-03T04:05:07.001Z`,
    ]);
    expect(built.err).toEqual([]);
    expect(built.sent()).toBe(1);
    expect(built.waits).toEqual([]);
  });

  it("builds the envelope from the arguments, not from the input", async () => {
    const bodies: string[] = [];
    const built = harness({
      stdin: JSON.stringify({
        schema: "waves/v1",
        project: "someone-else",
        wave: "wv9",
        generatedAt: "2020-01-01T00:00:00.000Z",
        intervalSeconds: 5,
        lanes: [laneWithTail("noisy\n")],
      }),
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });
    const deps = {
      ...built.deps,
      transport: () => ({
        send: async (request: { readonly body?: string }) => {
          bodies.push(request.body ?? "");
          return reply(200, ACCEPTED);
        },
      }),
    };

    expect(
      await push(command({ intervalSeconds: 60, includeTails: true }), deps),
    ).toBe(0);
    const sent = JSON.parse(bodies[0] ?? "{}") as Record<string, unknown>;
    expect(sent).toMatchObject({
      schema: "waves/v1",
      project: PROJECT,
      wave: WAVE,
      generatedAt: GENERATED_AT,
      intervalSeconds: 60,
    });
    expect(sent["lanes"]).toHaveLength(1);
  });

  it("deletes every tail unless tails were asked for", async () => {
    const bodies: string[] = [];
    const built = harness({
      stdin: lanesOnly("noisy\n"),
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });
    const deps = {
      ...built.deps,
      transport: () => ({
        send: async (request: { readonly body?: string }) => {
          bodies.push(request.body ?? "");
          return reply(200, ACCEPTED);
        },
      }),
    };

    await push(command(), deps);
    expect(bodies[0]).not.toContain("tail");
    expect(bodies[0]).not.toContain("noisy");
  });

  it("truncates a tail to its last 4096 bytes when tails were asked for", async () => {
    const bodies: string[] = [];
    const built = harness({
      stdin: lanesOnly("x".repeat(TAIL_BYTES + 5)),
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });
    const deps = {
      ...built.deps,
      transport: () => ({
        send: async (request: { readonly body?: string }) => {
          bodies.push(request.body ?? "");
          return reply(200, ACCEPTED);
        },
      }),
    };

    await push(command({ includeTails: true }), deps);
    const sent = JSON.parse(bodies[0] ?? "{}") as {
      readonly lanes: {
        readonly derived: { readonly log: { readonly tail: string } };
      }[];
    };
    expect(sent.lanes[0]?.derived.log.tail).toBe("x".repeat(TAIL_BYTES));
  });

  it("reads the status from a file", async () => {
    const bodies: string[] = [];
    const built = harness({
      files: {
        "/tmp/status.json": { text: lanesOnly("noisy\n"), mode: 0o644 },
        [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 },
      },
    });
    const deps = {
      ...built.deps,
      transport: () => ({
        send: async (request: { readonly body?: string }) => {
          bodies.push(request.body ?? "");
          return reply(200, ACCEPTED);
        },
      }),
    };

    expect(
      await push(
        command({ source: { kind: "file", path: "/tmp/status.json" } }),
        deps,
      ),
    ).toBe(0);
    expect(JSON.parse(bodies[0] ?? "{}")).toMatchObject({ wave: WAVE });
  });

  it("refuses a status file that is not there", async () => {
    const built = harness({
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });
    await expect(
      push(
        command({ source: { kind: "file", path: "/tmp/missing.json" } }),
        built.deps,
      ),
    ).rejects.toThrow("cannot read /tmp/missing.json");
    expect(built.sent()).toBe(0);
  });

  it("refuses input that is not JSON, or not a status for one wave", async () => {
    const built = harness({
      stdin: "not json",
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });
    await expect(push(command(), built.deps)).rejects.toThrow(
      "the input is not valid JSON",
    );

    const other = harness({
      stdin: '{"lanes":"none"}',
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });
    await expect(push(command(), other.deps)).rejects.toThrow(
      'the input must be {"lanes": [...]} or a waves/v1 envelope',
    );
  });

  it("refuses an envelope the contract would not take, and prints the pointers", async () => {
    const built = harness({
      stdin: JSON.stringify({ lanes: [{ id: "wv5" }] }),
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });
    await expect(push(command(), built.deps)).rejects.toThrow(
      "the envelope is not valid:\n  /lanes/0/derived: expected an object",
    );
    expect(built.sent()).toBe(0);
  });

  it("wants a project, a token and a server before it sends anything", async () => {
    const noProject = harness({
      vars: { WAVES_PROJECT: undefined },
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });
    await expect(push(command(), noProject.deps)).rejects.toThrow(
      "WAVES_PROJECT is required",
    );

    const noToken = harness({ stdin: lanesOnly("noisy\n") });
    await expect(push(command(), noToken.deps)).rejects.toThrow(
      `no token for ${PROJECT} at ${tokenPath}`,
    );
  });

  it("refuses a 200 without a receivedAt", async () => {
    const built = harness({
      script: [reply(200, "{}")],
      stdin: lanesOnly("noisy\n"),
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });
    await expect(push(command(), built.deps)).rejects.toThrow(
      "push failed: the server sent no receivedAt",
    );
  });
});

describe("the retry policy of a push", () => {
  it("waits for Retry-After when the server throttles it", async () => {
    const built = harness({
      script: [
        reply(429, '{"error":"slow down"}', { "retry-after": "1" }),
        reply(200, ACCEPTED),
      ],
      stdin: lanesOnly("noisy\n"),
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });

    expect(await push(command(), built.deps)).toBe(0);
    expect(built.waits).toEqual([1000]);
    expect(built.sent()).toBe(2);
  });

  it("waits for an HTTP-date the server sent instead", async () => {
    const built = harness({
      script: [
        reply(429, "", {
          "retry-after": "Tue, 03 Feb 2026 04:05:09 GMT",
        }),
        reply(200, ACCEPTED),
      ],
      stdin: lanesOnly("noisy\n"),
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });

    expect(await push(command(), built.deps)).toBe(0);
    expect(built.waits).toEqual([3000]);
  });

  it("gives up after three throttles", async () => {
    const throttled = reply(429, "", { "retry-after": "1" });
    const built = harness({
      script: [throttled, throttled, throttled, throttled],
      stdin: lanesOnly("noisy\n"),
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });

    await expect(push(command(), built.deps)).rejects.toThrow(
      "push failed: 429 Too Many Requests",
    );
    expect(built.sent()).toBe(4);
    expect(built.waits).toEqual([1000, 1000, 1000]);
  });

  it("never retries early when the server asks for longer than a minute", async () => {
    const built = harness({
      script: [reply(429, "", { "retry-after": "600" }), reply(200, ACCEPTED)],
      stdin: lanesOnly("noisy\n"),
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });

    await expect(push(command(), built.deps)).rejects.toThrow(
      "push failed: 429 Too Many Requests; the server asked to wait 600s",
    );
    expect(built.sent()).toBe(1);
    expect(built.waits).toEqual([]);
  });

  it("retries a 5xx once and then twice, with a backoff", async () => {
    const broken = reply(502, "");
    const built = harness({
      script: [broken, broken, reply(200, ACCEPTED)],
      stdin: lanesOnly("noisy\n"),
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });

    expect(await push(command(), built.deps)).toBe(0);
    expect(built.waits).toEqual([1000, 2000]);
  });

  it("gives up after two 5xx", async () => {
    const broken = reply(503, "");
    const built = harness({
      script: [broken, broken, broken],
      stdin: lanesOnly("noisy\n"),
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });

    await expect(push(command(), built.deps)).rejects.toThrow(
      "push failed: 503 Service Unavailable",
    );
    expect(built.sent()).toBe(3);
  });

  it("retries a request that got no answer at all", async () => {
    const built = harness({
      script: [network("socket hang up"), reply(200, ACCEPTED)],
      stdin: lanesOnly("noisy\n"),
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });

    expect(await push(command(), built.deps)).toBe(0);
    expect(built.waits).toEqual([1000]);
  });

  it("gives up after two answers that never came", async () => {
    const lost = network("socket hang up");
    const built = harness({
      script: [lost, lost, lost],
      stdin: lanesOnly("noisy\n"),
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });

    await expect(push(command(), built.deps)).rejects.toThrow(
      "push failed: socket hang up",
    );
    expect(built.sent()).toBe(3);
  });

  it("keeps a throttled answer whose body the connection cut short", async () => {
    const built = harness({
      script: [
        reply(429, '{"error":"slow', { "retry-after": "2" }),
        reply(200, ACCEPTED),
      ],
      stdin: lanesOnly("noisy\n"),
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });

    // The Retry-After arrived with the headers, so it is honoured even though the
    // explanation behind it never finished arriving.
    expect(await push(command(), built.deps)).toBe(0);
    expect(built.waits).toEqual([2000]);
    expect(built.sent()).toBe(2);
  });

  it("counts a broken server and a throttling one against separate budgets", async () => {
    const built = harness({
      script: [
        reply(503, ""),
        reply(429, "", { "retry-after": "1" }),
        reply(429, "", { "retry-after": "1" }),
        reply(200, ACCEPTED),
      ],
      stdin: lanesOnly("noisy\n"),
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });

    expect(await push(command(), built.deps)).toBe(0);
    expect(built.sent()).toBe(4);
    // One 5xx and two throttles: three waits drawn from two budgets of two and
    // three, which one shared counter would have refused.
    expect(built.waits).toEqual([1000, 1000, 1000]);
  });

  it("never repeats a request the server refused", async () => {
    const built = harness({
      script: [
        reply(403, '{"error":"another project\'s token"}'),
        reply(200, ACCEPTED),
      ],
      stdin: lanesOnly("noisy\n"),
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });

    await expect(push(command(), built.deps)).rejects.toThrow(
      "push failed: 403 Forbidden\n  another project's token",
    );
    expect(built.sent()).toBe(1);
    expect(built.waits).toEqual([]);
  });

  it("keeps a refusal whose body the connection cut short", async () => {
    const built = harness({
      script: [
        reply(401, '{"error":"the project token was ref', {
          "www-authenticate": 'Bearer realm="waves"',
        }),
        reply(200, ACCEPTED),
      ],
      stdin: lanesOnly("noisy\n"),
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });

    // The status is the verdict; a half-read explanation is simply not there to
    // print, and the refusal is not repeated.
    await expect(push(command(), built.deps)).rejects.toThrow(
      "push failed: 401 Unauthorized",
    );
    expect(built.sent()).toBe(1);
    expect(built.waits).toEqual([]);
  });

  it("prints the pointers of a 422 the client could not see", async () => {
    const built = harness({
      script: [
        reply(422, '{"errors":[{"path":"/wave","message":"not a wave id"}]}'),
        reply(200, ACCEPTED),
      ],
      stdin: lanesOnly("noisy\n"),
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });

    await expect(push(command(), built.deps)).rejects.toThrow(
      "push failed: 422 Unprocessable Content\n  /wave: not a wave id",
    );
    expect(built.sent()).toBe(1);
  });

  it("refuses a body the server would not accept", async () => {
    const built = harness({
      script: [reply(413, ""), reply(200, ACCEPTED)],
      stdin: lanesOnly("noisy\n"),
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });

    await expect(push(command(), built.deps)).rejects.toThrow(
      "push failed: 413 Content Too Large",
    );
    expect(built.sent()).toBe(1);
  });
});
