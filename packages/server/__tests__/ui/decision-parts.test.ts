import { describe, expect, it } from "vitest";

import { decisionModel } from "../../public/views/decision-model.js";
import {
  commitmentsBlock,
  evidenceBlock,
  optionsBlock,
} from "../../public/views/decision-parts.js";

import type { DecisionView } from "../../src/application/notice-read-model.js";
import {
  decisionRevision,
  decisionResponse,
  inboxHead,
  storedRevision,
} from "./fixtures.js";
import { assertNoInjectedMarkup, freshRoot, textsOf } from "./helpers.js";

/** Draws a section from a model and returns the host. */
function draw(node: HTMLElement | undefined): HTMLElement {
  const host = freshRoot();
  if (node !== undefined) {
    host.append(node);
  }
  assertNoInjectedMarkup();
  return host;
}

/** Draws the options block from a checked response. */
function drawOptions(overrides: Partial<DecisionView>): HTMLElement {
  return draw(optionsBlock(decisionModel(decisionResponse(overrides))));
}

/** Draws the commitments block from a checked response. */
function drawCommits(overrides: Partial<DecisionView>): HTMLElement {
  return draw(commitmentsBlock(decisionModel(decisionResponse(overrides))));
}

/** Draws the evidence block from a checked response. */
function drawEvidence(overrides: Partial<DecisionView>): HTMLElement {
  return draw(evidenceBlock(decisionModel(decisionResponse(overrides))));
}

describe("optionsBlock", () => {
  it("shows the options of a choice with its costs", () => {
    const host = drawOptions({
      revisions: [
        storedRevision({
          decision: decisionRevision({
            options: [
              { key: "a", text: "Yes", cost: "C1" },
              { key: "b", text: "No", cost: "C2" },
            ],
          }),
        }),
      ],
    });
    expect(host.querySelector(".decision-options")).not.toBeNull();
    expect(textsOf(host, ".option-head")).toStrictEqual(["a: Yes", "b: No"]);
    expect(textsOf(host, ".option-cost")).toStrictEqual([
      "Cost: C1",
      "Cost: C2",
    ]);
  });

  it("marks the recommended option and gives its reason", () => {
    const host = drawOptions({
      revisions: [
        storedRevision({
          decision: decisionRevision({
            options: [
              { key: "a", text: "Yes", cost: "C1" },
              { key: "b", text: "No", cost: "C2" },
            ],
            recommended: { option: "a", reason: "best" },
          }),
        }),
      ],
    });
    expect(textsOf(host, ".option-head")).toStrictEqual([
      "Recommended · a: Yes",
      "b: No",
    ]);
    expect(textsOf(host, ".option-why")).toStrictEqual(["Why: best"]);
  });

  it("says No recommendation given when there is none", () => {
    const host = drawOptions({
      revisions: [
        storedRevision({
          decision: decisionRevision({
            options: [
              { key: "a", text: "Yes", cost: "C1" },
              { key: "b", text: "No", cost: "C2" },
            ],
          }),
        }),
      ],
    });
    expect(textsOf(host, ".no-recommendation")).toStrictEqual([
      "No recommendation given.",
    ]);
  });

  it("shows act-elsewhere under What you would do for an action", () => {
    const host = drawOptions({
      head: inboxHead({ shape: "action" }),
      revisions: [
        storedRevision({
          decision: decisionRevision({
            shape: "action",
            options: [],
            actElsewhere: { where: "terminal", what: "run this" },
          }),
        }),
      ],
    });
    expect(textsOf(host, "h2")).toStrictEqual(["What you would do"]);
    expect(textsOf(host, ".card-elsewhere")).toStrictEqual([
      "Cannot be answered here. Act in: terminal: run this.",
    ]);
  });

  it("shows applies-to links for an instruction", () => {
    const host = drawOptions({
      head: inboxHead({ shape: "instruction" }),
      revisions: [
        storedRevision({
          decision: decisionRevision({
            shape: "instruction",
            options: [],
            appliesTo: ["alpha", "beta"],
          }),
        }),
      ],
    });
    expect(textsOf(host, "h2")).toStrictEqual(["Applies to"]);
    expect(textsOf(host, ".applies-to a")).toStrictEqual(["alpha", "beta"]);
    expect(host.querySelector(".applies-to a")?.getAttribute("href")).toBe(
      "/p/alpha",
    );
  });
});

describe("commitmentsBlock", () => {
  it("shows one item per commitment under the heading", () => {
    const host = drawCommits({
      revisions: [
        storedRevision({
          decision: decisionRevision({
            commits: ["commit one", "commit two", "commit three"],
          }),
        }),
      ],
    });
    expect(textsOf(host, "h2")).toStrictEqual([
      "Approving this commits you to",
    ]);
    expect(textsOf(host, ".commits li")).toStrictEqual([
      "commit one",
      "commit two",
      "commit three",
    ]);
  });

  it("returns undefined when there are no commits", () => {
    const host = drawCommits({});
    expect(host.querySelector(".decision-commits")).toBeNull();
  });
});

describe("evidenceBlock", () => {
  it("links each evidence source with the right attributes", () => {
    const host = drawEvidence({
      revisions: [
        storedRevision({
          decision: decisionRevision({
            evidence: [
              {
                label: "PR 731",
                href: "https://github.com/acme/waves/pull/731",
              },
              { label: "docs", href: "https://ac.me/docs" },
            ],
          }),
        }),
      ],
    });
    expect(textsOf(host, "h2")).toStrictEqual(["Evidence"]);
    const links = host.querySelectorAll(".evidence a");
    expect(links).toHaveLength(2);
    expect(links[0]?.textContent).toBe("PR 731");
    expect(links[0]?.getAttribute("href")).toBe(
      "https://github.com/acme/waves/pull/731",
    );
    expect(links[0]?.getAttribute("rel")).toBe("noreferrer noopener");
    expect(links[0]?.getAttribute("target")).toBe("_blank");
    expect(links[1]?.textContent).toBe("docs");
    expect(links[1]?.getAttribute("href")).toBe("https://ac.me/docs");
  });

  it("shows refs as plain text when present", () => {
    const host = drawEvidence({
      revisions: [
        storedRevision({
          decision: decisionRevision({
            refs: { wave: "platform-w07", lane: "PT-9x", pr: 731 },
          }),
        }),
      ],
    });
    expect(textsOf(host, ".decision-refs")).toStrictEqual([
      "wave platform-w07 · lane PT-9x · PR #731",
    ]);
  });

  it("shows refs without a PR when one is absent", () => {
    const host = drawEvidence({
      revisions: [
        storedRevision({
          decision: decisionRevision({ refs: { wave: "w-1", lane: "l-1" } }),
        }),
      ],
    });
    expect(textsOf(host, ".decision-refs")).toStrictEqual([
      "wave w-1 · lane l-1",
    ]);
  });

  it("returns undefined when there is no evidence and no refs", () => {
    const host = drawEvidence({});
    expect(host.querySelector(".decision-evidence")).toBeNull();
  });

  it("falls back to text when an evidence href is https but not a valid URL", () => {
    const host = drawEvidence({
      revisions: [
        storedRevision({
          decision: decisionRevision({
            evidence: [{ label: "link", href: "https://" }],
          }),
        }),
      ],
    });
    expect(host.querySelectorAll(".evidence a")).toHaveLength(0);
    expect(textsOf(host, ".evidence li")).toStrictEqual(["link"]);
  });

  it("shows only refs when evidence is empty but refs are present", () => {
    const host = drawEvidence({
      revisions: [
        storedRevision({
          decision: decisionRevision({ refs: { pr: 1 } }),
        }),
      ],
    });
    expect(textsOf(host, ".decision-refs")).toStrictEqual(["PR #1"]);
    expect(host.querySelectorAll(".evidence")).toHaveLength(0);
  });
});
