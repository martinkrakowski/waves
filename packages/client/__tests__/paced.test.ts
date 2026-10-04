import { describe, expect, it } from "vitest";

import { SYNC_SPACING_MS, pacedTransport } from "../src/application/paced.js";
import type {
  HttpRequest,
  TransportOutcome,
} from "../src/application/ports.js";
import { reply } from "./support/harness.js";

const REQUEST: HttpRequest = {
  method: "PUT",
  url: "http://127.0.0.1:8080/api/v1/projects/waves-demo/waves/wv5",
  bearer: "t0ken",
};

const ANSWER: TransportOutcome = reply(200, "{}");

/** A clock and a sleeper of the test's own, so a pace can be watched. */
function timing(start = 10_000): {
  readonly deps: {
    clock: { now(): number };
    sleeper: { sleep(ms: number): Promise<void> };
  };
  readonly waits: number[];
  readonly pass: (ms: number) => void;
} {
  const waits: number[] = [];
  let now = start;
  return {
    deps: {
      clock: { now: () => now },
      sleeper: {
        sleep: async (ms) => {
          waits.push(ms);
          now += ms;
        },
      },
    },
    waits,
    pass: (ms) => {
      now += ms;
    },
  };
}

/** A transport that answers, and remembers what went through it. */
function counting(outcomes: readonly TransportOutcome[] = [ANSWER]): {
  readonly inner: { send(request: HttpRequest): Promise<TransportOutcome> };
  readonly sent: number[];
} {
  const remaining = [...outcomes];
  const sent: number[] = [];
  return {
    inner: {
      send: async () => {
        sent.push(sent.length);
        const next = remaining.shift();
        if (next === undefined) {
          throw new Error("the inner transport ran out of answers");
        }
        return next;
      },
    },
    sent,
  };
}

describe("a paced transport", () => {
  it("sends the first request at once: nothing has been sent yet", async () => {
    const { deps, waits } = timing();
    const inner = counting();

    await pacedTransport(inner.inner, deps).send(REQUEST);

    expect(inner.sent).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it("waits a whole second between two sends, and does not wait twice", async () => {
    const { deps, waits } = timing();
    const inner = counting([ANSWER, ANSWER, ANSWER]);
    const paced = pacedTransport(inner.inner, deps);

    await paced.send(REQUEST);
    await paced.send(REQUEST);
    await paced.send(REQUEST);

    expect(waits).toEqual([SYNC_SPACING_MS, SYNC_SPACING_MS]);
    expect(inner.sent).toHaveLength(3);
  });

  it("waits only what is left of the second, when the clock moved on", async () => {
    const { deps, waits, pass } = timing();
    const inner = counting([ANSWER, ANSWER]);
    const paced = pacedTransport(inner.inner, deps);

    await paced.send(REQUEST);
    pass(900);
    await paced.send(REQUEST);

    expect(waits).toEqual([100]);
  });

  it("does not wait at all when the second has already passed", async () => {
    const { deps, waits, pass } = timing();
    const inner = counting([ANSWER, ANSWER]);
    const paced = pacedTransport(inner.inner, deps);

    await paced.send(REQUEST);
    pass(SYNC_SPACING_MS + 1);
    await paced.send(REQUEST);

    expect(waits).toEqual([]);
  });

  it("paces a retry too, because a retry goes through it as well", async () => {
    const { deps, waits } = timing();
    const inner = counting([
      reply(429, "", { "retry-after": "0" }),
      ANSWER,
      ANSWER,
    ]);
    const paced = pacedTransport(inner.inner, deps);

    await paced.send(REQUEST);
    // A Retry-After of 0 asks for no wait at all, and the pace is still a second.
    await paced.send(REQUEST);
    await paced.send(REQUEST);

    expect(waits).toEqual([SYNC_SPACING_MS, SYNC_SPACING_MS]);
  });
});
