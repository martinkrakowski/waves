import { describe, expect, it } from "vitest";

import {
  MAX_COLLECTOR_WAVES,
  readCollectorOutput,
  type CollectorOutput,
} from "../src/domain/collector.js";

const LANES = [{ id: "wv5", reported: {}, derived: {}, disagreements: [] }];

function accepted(text: string): CollectorOutput {
  const read = readCollectorOutput(text);
  if (!read.ok) {
    throw new Error(`expected this output to be accepted: ${read.error}`);
  }
  return read.output;
}

function refused(text: string): string {
  const read = readCollectorOutput(text);
  if (read.ok) {
    throw new Error(`expected this output to be refused: ${text}`);
  }
  return read.error;
}

describe("what a collector prints", () => {
  it("is one wave with its lanes", () => {
    expect(
      accepted(
        JSON.stringify({
          waves: [{ wave: "wv5", lanes: LANES }],
        }),
      ),
    ).toEqual({ waves: [{ wave: "wv5", lanes: LANES }] });
  });

  it("may print a status as well, and may print no waves at all", () => {
    expect(
      accepted(
        JSON.stringify({
          waves: [{ wave: "wv5", lanes: [] }],
          status: { prs: { skipped: 2 } },
        }),
      ),
    ).toEqual({
      waves: [{ wave: "wv5", lanes: [] }],
      status: { prs: { skipped: 2 } },
    });
    expect(accepted(JSON.stringify({ waves: [] }))).toEqual({ waves: [] });
  });

  it("may print up to the cap, and no more", () => {
    const waves = (count: number): string =>
      JSON.stringify({
        waves: Array.from({ length: count }, (_, at) => ({
          wave: `wv${at}`,
          lanes: [],
        })),
      });
    expect(accepted(waves(MAX_COLLECTOR_WAVES)).waves).toHaveLength(
      MAX_COLLECTOR_WAVES,
    );
    expect(refused(waves(MAX_COLLECTOR_WAVES + 1))).toBe(
      `the collector printed 33 waves; at most ${MAX_COLLECTOR_WAVES} are read`,
    );
  });
});

describe("output that is not the shape a collector owes", () => {
  it("is refused for what it is", () => {
    expect(refused("not json")).toBe(
      "the collector printed something that is not JSON",
    );
    expect(refused("[]")).toBe(
      "the collector printed something that is not a JSON object",
    );
    expect(refused("7")).toBe(
      "the collector printed something that is not a JSON object",
    );
  });

  it("is refused for a key this client does not know, at either level", () => {
    expect(refused(JSON.stringify({ lanes: [], every: 60 }))).toBe(
      "the collector printed a key this client does not know",
    );
    expect(
      refused(
        JSON.stringify({ waves: [{ wave: "wv5", lanes: [], tails: [] }] }),
      ),
    ).toBe("wave 0: holds a key this client does not know");
  });

  it("is refused for a status that is not an object", () => {
    expect(refused(JSON.stringify({ waves: [], status: "alive" }))).toBe(
      "the collector's status must be a JSON object",
    );
  });

  it("is refused when there is no waves array", () => {
    expect(refused(JSON.stringify({ status: {} }))).toBe(
      "the collector printed no waves array",
    );
    expect(refused(JSON.stringify({ waves: {} }))).toBe(
      "the collector printed no waves array",
    );
  });
});

describe("one wave of a collector's output", () => {
  it("must be an object with a wave id and an array of lanes", () => {
    expect(refused(JSON.stringify({ waves: ["wv5"] }))).toBe(
      "wave 0: must be an object with a wave and its lanes",
    );
    expect(refused(JSON.stringify({ waves: [{ lanes: [] }] }))).toBe(
      "wave 0: wave is not a wave id",
    );
    expect(
      refused(JSON.stringify({ waves: [{ wave: "not a wave", lanes: [] }] })),
    ).toBe("wave 0: wave is not a wave id");
    expect(refused(JSON.stringify({ waves: [{ wave: 5, lanes: [] }] }))).toBe(
      "wave 0: wave is not a wave id",
    );
    expect(refused(JSON.stringify({ waves: [{ wave: "wv5" }] }))).toBe(
      "wave 0: lanes must be an array",
    );
    expect(
      refused(JSON.stringify({ waves: [{ wave: "wv5", lanes: {} }] })),
    ).toBe("wave 0: lanes must be an array");
  });

  it("may not name the same wave twice", () => {
    expect(
      refused(
        JSON.stringify({
          waves: [
            { wave: "wv5", lanes: [] },
            { wave: "wv9", lanes: [] },
            { wave: "wv5", lanes: [] },
          ],
        }),
      ),
    ).toBe("the collector printed wave wv5 twice");
  });

  it("is named by its index in what the collector printed", () => {
    expect(
      refused(
        JSON.stringify({
          waves: [
            { wave: "wv5", lanes: [] },
            { wave: "wv9", lanes: [] },
            { wave: 5, lanes: [] },
          ],
        }),
      ),
    ).toBe("wave 2: wave is not a wave id");
  });
});
