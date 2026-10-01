import { describe, expect, it } from "vitest";

import { visibleWaves } from "../../public/wave.js";

import type { WaveSummary } from "../../src/application/read-model.js";
import { waveSummary, waveView } from "./fixtures.js";
import { oneOf, renderPanel, textsOf } from "./helpers.js";

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

describe("the wave panel", () => {
  it("names the project and links back to the list", () => {
    const { host } = renderPanel({ project: "alpha" });
    expect(textsOf(host, "h1 a")).toStrictEqual(["waves"]);
    expect(host.querySelector("h1 a")?.getAttribute("href")).toBe("/");
    expect(textsOf(host, "h1 code")).toStrictEqual(["alpha"]);
  });

  it("lists the waves newest first, with the selected one marked", () => {
    const { host } = renderPanel({
      waves: [
        waveSummary({ wave: "w-3" }),
        waveSummary({ wave: "w-2", receivedAt: "2026-04-01T11:50:00.000Z" }),
      ],
      selected: "w-2",
    });
    expect(textsOf(host, ".wave code")).toStrictEqual(["w-3", "w-2"]);
    const current = host.querySelectorAll(".wave.current");
    expect(current).toHaveLength(1);
    expect(textsOf(current[0] as HTMLElement, "code")).toStrictEqual(["w-2"]);
  });

  it("reports the lane count, the interval and how long ago each wave landed", () => {
    const { host } = renderPanel({
      waves: [
        waveSummary({ lanes: 1, intervalSeconds: 30 }),
        waveSummary({
          wave: "w-2",
          lanes: 4,
          intervalSeconds: null,
          receivedAt: "2026-04-01T11:00:00.000Z",
        }),
      ],
    });
    expect(textsOf(host, ".wave .meta")).toStrictEqual([
      "1 lane · every 30s",
      "4 lanes · no interval",
    ]);
    expect(textsOf(host, ".wave span[title]")).toStrictEqual([
      "just now",
      "1h ago",
    ]);
  });

  it("badges a stale wave, and a wave past retention once it is shown", () => {
    const stale = renderPanel({
      waves: [waveSummary({ wave: "w-3", stale: true, retained: true })],
    });
    expect(textsOf(stale.host, ".wave .badge")).toStrictEqual(["stale"]);

    const aging = renderPanel({
      waves: [waveSummary({ wave: "w-3", retained: false })],
      showAll: true,
    });
    expect(textsOf(aging.host, ".wave .badge")).toStrictEqual([
      "past retention",
    ]);
  });

  it("asks for the hidden waves and hands them back when told to", () => {
    const hidden = waveSummary({ wave: "w-1", retained: false });
    const collapsed = renderPanel({ waves: [waveSummary(), hidden] });
    expect(textsOf(collapsed.host, ".wave code")).toStrictEqual(["w-3"]);
    const toggle = oneOf(collapsed.host, ".toggle") as HTMLElement;
    expect(toggle.textContent).toBe("show 1 wave past retention");
    toggle.click();
    expect(collapsed.toggles).toBe(1);

    const expanded = renderPanel({
      waves: [waveSummary(), hidden],
      showAll: true,
    });
    expect(textsOf(expanded.host, ".wave code")).toStrictEqual(["w-3", "w-1"]);
    expect(oneOf(expanded.host, ".toggle")?.textContent).toBe(
      "show only retained",
    );
  });

  it("offers no toggle when every wave is still retained", () => {
    const { host } = renderPanel();
    expect(host.querySelectorAll(".toggle")).toHaveLength(0);
  });

  it("says which wave the user picked", () => {
    const { host, picked } = renderPanel({
      waves: [waveSummary({ wave: "w-3" }), waveSummary({ wave: "w-2" })],
      selected: "w-3",
    });
    (host.querySelectorAll(".wave")[1] as HTMLElement).click();
    expect(picked).toStrictEqual(["w-2"]);
  });

  it("says so when the project has pushed nothing at all", () => {
    const { host } = renderPanel({ waves: [], selected: "", view: undefined });
    expect(textsOf(host, ".empty")).toStrictEqual([
      "No waves pushed yet.",
      "This project has no waves yet.",
    ]);
    expect(host.querySelectorAll(".toggle")).toHaveLength(0);
  });

  it("says so when every wave is already past retention", () => {
    const { host } = renderPanel({
      waves: [waveSummary({ retained: false })],
      view: undefined,
    });
    expect(textsOf(host, ".empty")).toStrictEqual([
      "Every wave is past retention.",
      "That wave is no longer stored.",
    ]);
  });

  it("says so when the wave it was showing is gone", () => {
    const { host } = renderPanel({ view: undefined });
    expect(textsOf(host, ".empty")).toStrictEqual([
      "That wave is no longer stored.",
    ]);
  });

  it("copes with a wave that arrived without a timestamp", () => {
    const { host } = renderPanel({
      waves: [waveSummary({ receivedAt: undefined as unknown as string })],
    });
    expect(textsOf(host, ".wave span[title]")).toStrictEqual(["unknown"]);
  });

  it("heads the lane panel with the wave and its lane count", () => {
    const { host } = renderPanel({
      view: waveView({ receivedAt: "2026-04-01T11:59:00.000Z" }),
    });
    expect(textsOf(host, ".lane-panel h2 code")).toStrictEqual(["w-3"]);
    expect(textsOf(host, ".lane-panel h2 .meta")).toStrictEqual([
      " · 2 lanes 1m ago",
    ]);
  });

  it("warns about a stale wave, and only about a stale wave", () => {
    const fresh = renderPanel();
    expect(fresh.host.querySelectorAll(".banner")).toHaveLength(0);
    const stale = renderPanel({ view: waveView({ stale: true }) });
    expect(textsOf(stale.host, ".banner")).toStrictEqual([
      "This wave is stale: no snapshot arrived inside its interval, so lane liveness reads unknown.",
    ]);
  });
});
