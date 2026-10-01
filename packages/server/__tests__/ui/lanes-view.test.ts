import { describe, expect, it } from "vitest";

import { envelope, lane, NOW_ISO, waveView } from "./fixtures.js";
import { laneCells, oneOf, renderPanel, textsOf } from "./helpers.js";

function withLanes(
  ...lanes: ReturnType<typeof lane>[]
): ReturnType<typeof waveView> {
  return waveView({ envelope: envelope({ lanes }) });
}

describe("the lane table", () => {
  it("has one column per fact and one row per lane", () => {
    const { host } = renderPanel();
    expect(textsOf(host, "thead th")).toStrictEqual([
      "lane",
      "reported",
      "alive",
      "pr",
      "gate",
      "diff",
      "notes",
    ]);
    expect(host.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(laneCells(host, 0)[0]).toContain("wv-a");
    expect(laneCells(host, 1)[0]).toContain("wv-b");
  });

  it("labels every cell for the narrow layout", () => {
    const { host } = renderPanel();
    const row = host.querySelectorAll("tbody tr")[0] as HTMLElement;
    const labels = Array.from(row.querySelectorAll("td"), (cell) =>
      cell.getAttribute("data-label"),
    );
    expect(labels).toStrictEqual([
      "lane",
      "reported",
      "alive",
      "pr",
      "gate",
      "diff",
      "notes",
    ]);
  });

  it("reports every field a healthy lane carries", () => {
    const { host } = renderPanel();
    const row = laneCells(host, 0);
    expect(row[0]).toBe("wv-aseat s1");
    expect(row[1]).toBe(
      "review · settled · round 2 · PR #42just nowverdict: ship itrisk: low",
    );
    expect(row[2]).toBe("running");
    expect(row[3]).toBe("#42 open · checks pass · 1 open thread");
    expect(row[4]).toBe(
      "exit 0 · 98% stmts · 91.5% br · 100% funcs · 99% lines",
    );
    expect(row[5]).toBe("3 files · +120 −14");
    expect(row[6]).toBe(
      "seat 1 says pass, the gate says fail" +
        `plan review: two approvalsrisk: lowlast 4 KiB as of ${NOW_ISO}gate ok\ntests ok`,
    );
  });

  it("puts the exact reported time in a title", () => {
    const { host } = renderPanel();
    const row = host.querySelectorAll("tbody tr")[0] as HTMLElement;
    const stamp = oneOf(row, "td[data-label='reported'] span[title]");
    expect(stamp?.getAttribute("title")).toBe(NOW_ISO);
  });

  it("renders a detail value that is not a string as JSON", () => {
    const { host } = renderPanel({
      view: withLanes(
        lane({
          reported: {
            stage: "review",
            event: "started",
            ts: NOW_ISO,
            detail: { attempts: 2, note: "kept" },
          },
        }),
      ),
    });
    expect(textsOf(host, ".detail li")).toStrictEqual([
      "attempts: 2",
      "note: kept",
    ]);
  });

  it("reads a lane that reported nothing at all", () => {
    const { host } = renderPanel({
      view: withLanes(
        lane({
          seat: undefined,
          reported: undefined,
          derived: { alive: false },
          disagreements: [],
        }),
      ),
    });
    expect(laneCells(host, 0)).toStrictEqual([
      "wv-a",
      "nothing reported",
      "stopped",
      "no pull request reported",
      "no gate reported",
      "no diff reported",
      "noneno tail pushed",
    ]);
  });

  it("keeps a partial pull request readable", () => {
    const { host } = renderPanel({
      view: withLanes(
        lane({
          derived: {
            alive: true,
            pr: { number: 7, state: "merged", checks: "none" },
          },
        }),
      ),
    });
    expect(laneCells(host, 0)[3]).toBe(
      "#7 merged · checks none · threads not reported",
    );
  });

  it("keeps a partial report readable", () => {
    const { host } = renderPanel({
      view: withLanes(
        lane({
          reported: {
            stage: "build",
            event: "failed",
            ts: NOW_ISO,
            detail: {},
          },
        }),
      ),
    });
    expect(laneCells(host, 0)[1]).toBe("build · failedjust now");
  });

  it("reads a report that carries no detail at all", () => {
    const { host } = renderPanel({
      view: withLanes(
        lane({ reported: { stage: "build", event: "started", ts: NOW_ISO } }),
      ),
    });
    expect(laneCells(host, 0)[1]).toBe("build · startedjust now");
    expect(host.querySelectorAll(".detail")).toHaveLength(0);
    expect(textsOf(host, ".prose li")).toStrictEqual([
      "plan review: two approvals",
      "risk: low",
    ]);
  });

  it("reads liveness as unknown when the wave is stale", () => {
    const { host } = renderPanel({
      view: waveView({
        stale: true,
        envelope: envelope({
          lanes: [
            lane({ derived: { alive: "unknown" } }),
            lane({ id: "wv-b", derived: { alive: "unknown" } }),
          ],
        }),
      }),
    });
    expect(textsOf(host, "td[data-label='alive']")).toStrictEqual([
      "unknown",
      "unknown",
    ]);
    expect(host.querySelectorAll(".badge.running")).toHaveLength(0);
  });

  it("collapses the log tail", () => {
    const { host } = renderPanel();
    const details = host.querySelectorAll("details");
    expect(details).toHaveLength(2);
    expect((details[0] as HTMLDetailsElement).open).toBe(false);
    expect(textsOf(host, "details summary")).toStrictEqual([
      `last 4 KiB as of ${NOW_ISO}`,
      `last 4 KiB as of ${NOW_ISO}`,
    ]);
    expect(textsOf(host, "pre.tail")).toStrictEqual([
      "gate ok\ntests ok",
      "gate ok\ntests ok",
    ]);
  });

  it("keeps every disagreement as its own line", () => {
    const { host } = renderPanel({
      view: withLanes(lane({ disagreements: ["one", "two", "three"] })),
    });
    expect(textsOf(host, ".disagreements li")).toStrictEqual([
      "one",
      "two",
      "three",
    ]);
  });
});
