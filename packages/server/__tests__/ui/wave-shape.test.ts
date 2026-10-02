import { describe, expect, it } from "vitest";

import {
  drawableWave,
  drawableWaves,
  visibleWaves,
} from "../../public/wave.js";

import type {
  EnvelopeView,
  LaneDerivedView,
  LaneView,
  WaveSummary,
} from "../../src/application/read-model.js";
import { envelope, lane, waveSummary, waveView } from "./fixtures.js";

/**
 * What the wave strip and the project's own shape check lean on. `drawableWave`
 * and `api.wave` are lane K6's drawer, and keep these tests until it lands.
 */

describe("visibleWaves", () => {
  const waves: WaveSummary[] = [
    waveSummary({ wave: "a", retained: true }),
    waveSummary({ wave: "b", retained: false }),
  ];

  it("hides the waves past retention until asked", () => {
    expect(visibleWaves(waves, false).map((head) => head.wave)).toStrictEqual([
      "a",
    ]);
    expect(visibleWaves(waves, true)).toStrictEqual(waves);
  });
});

describe("drawableWaves", () => {
  it("knows which wave lists it can show", () => {
    expect(drawableWaves([waveSummary()])).toBe(true);
    expect(drawableWaves([])).toBe(true);
    expect(drawableWaves([{}])).toBe(false);
    expect(drawableWaves([waveSummary(), null])).toBe(false);
    expect(drawableWaves([{ ...waveSummary(), lanes: "2" }])).toBe(false);
    expect(
      drawableWaves([{ ...waveSummary(), intervalSeconds: undefined }]),
    ).toBe(false);
    expect(drawableWaves([{ ...waveSummary(), intervalSeconds: "30" }])).toBe(
      false,
    );
    expect(drawableWaves([{ ...waveSummary(), retained: undefined }])).toBe(
      false,
    );
    expect(drawableWaves([{ ...waveSummary(), stale: "yes" }])).toBe(false);
    expect(drawableWaves(undefined)).toBe(false);
    expect(drawableWaves({})).toBe(false);
  });
});

describe("drawableWave", () => {
  const withLanes = (...lanes: unknown[]): unknown =>
    waveView({ envelope: envelope({ lanes: lanes as LaneView[] }) });

  it("takes a wave the API could have described", () => {
    expect(drawableWave(waveView())).toBe(true);
    expect(drawableWave(withLanes())).toBe(true);
  });

  it("takes the least a lane on the wire can be", () => {
    // No seat, no report, nothing derived but the one required field: a lane the
    // contract accepts must never read as a broken endpoint.
    const bare = { id: "wv-a", derived: { alive: false }, disagreements: [] };
    const stale = {
      id: "wv-b",
      derived: { alive: "unknown" },
      disagreements: [],
    };
    expect(
      drawableWave(
        waveView({
          envelope: envelope({
            intervalSeconds: null,
            lanes: [bare, stale] as unknown as LaneView[],
          }),
        }),
      ),
    ).toBe(true);
  });

  it.each([
    ["null", null],
    ["a wave id rather than a wave view", "w-3"],
    ["an envelope with nothing around it", { envelope: envelope() }],
    [
      "a view with no receivedAt",
      waveView({ receivedAt: undefined as unknown as string }),
    ],
    [
      "a view whose stale is a string",
      waveView({ stale: "no" as unknown as boolean }),
    ],
    [
      "a view with no staleAfterMs",
      waveView({ staleAfterMs: undefined as unknown as number }),
    ],
    [
      "a view with no envelope",
      waveView({ envelope: undefined as unknown as EnvelopeView }),
    ],
    [
      "a null envelope",
      waveView({ envelope: null as unknown as EnvelopeView }),
    ],
    [
      "an envelope with no wave",
      waveView({
        envelope: envelope({ wave: undefined as unknown as string }),
      }),
    ],
    [
      "an envelope with no generatedAt",
      waveView({
        envelope: envelope({ generatedAt: undefined as unknown as string }),
      }),
    ],
    [
      "lanes that are not a list",
      waveView({
        envelope: envelope({ lanes: "two" as unknown as LaneView[] }),
      }),
    ],
    ["a null lane", withLanes(null)],
    ["a lane that is not an object", withLanes("wv-a")],
    [
      "a lane with no id",
      withLanes(lane({ id: undefined as unknown as string })),
    ],
    [
      "a lane with no derived",
      withLanes(lane({ derived: undefined as unknown as LaneDerivedView })),
    ],
    [
      "a lane with a null derived",
      withLanes(lane({ derived: null as unknown as LaneDerivedView })),
    ],
    [
      "a lane whose derived is not an object",
      withLanes(lane({ derived: "alive" as unknown as LaneDerivedView })),
    ],
    [
      "a lane whose disagreements are not a list",
      withLanes(lane({ disagreements: "none" as unknown as string[] })),
    ],
    [
      "a lane with nothing derived",
      withLanes({ id: "wv-a", derived: {}, disagreements: [] }),
    ],
    [
      "a lane whose alive is neither a boolean nor unknown",
      withLanes({ id: "wv-a", derived: { alive: "yes" }, disagreements: [] }),
    ],
  ])("rejects %s", (_label, body) => {
    expect(drawableWave(body)).toBe(false);
  });
});
