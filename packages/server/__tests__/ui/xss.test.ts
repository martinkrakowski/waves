import { describe, expect, it } from "vitest";

import type {
  CheckStatus,
  LaneEvent,
  PullRequestState,
} from "@hexagen-monaco/waves-contract";

import type { ProjectCard } from "../../public/api.js";
import { projectList } from "../../public/projects.js";
import { wavePanel } from "../../public/wave.js";

import type { LaneView } from "../../src/application/read-model.js";
import { lane, NOW_ISO, NOW_MS, projectCard, waveSummary } from "./fixtures.js";
import { assertNoInjectedMarkup, freshRoot, textsOf } from "./helpers.js";

const IMG = "<img src=x onerror=alert(1)>";
const SCRIPT = '"><script>alert(1)</script>';
const HANDLER = '" onmouseover="alert(1)';
const CLOSING_DETAILS = "</details><img src=x onerror=alert(1)>";
const CREDENTIALS = "https://user:pass@evil.example/repo";
const REPO_PAYLOADS = [
  "javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  CREDENTIALS,
] as const;

const TEXT_PAYLOADS = [IMG, SCRIPT, HANDLER, CLOSING_DETAILS] as const;

/**
 * How many times one payload appears in the rendered *text* of a project card:
 * the name, the id and the repository. `lastPush` is fed the payload too, but a
 * timestamp reaches the document as a `title` attribute, not as text, and
 * `assertNoInjectedMarkup` is what holds attribute values to the no-`<` rule.
 */
const CARD_OCCURRENCES = 3;

/**
 * How many times one payload appears in the rendered text of a wave panel: the
 * project in the heading, the wave in the list, the wave in the lane-panel
 * heading, the lane id, the seat, the stage, the event, the one detail value,
 * the pull-request state, the pull-request checks, the plan review, the risk,
 * the one disagreement, the `generatedAt` in the tail label and the tail. The
 * timestamps and the wave id reach the document as attributes, not as text.
 */
const LANE_OCCURRENCES = 15;

function documentText(): string {
  return document.body.textContent ?? "";
}

/** How many times the payload appears in the rendered text, exactly. */
function occurrencesOf(payload: string): number {
  return documentText().split(payload).length - 1;
}

function expectVerbatim(payload: string, times: number): void {
  expect(occurrencesOf(payload)).toBe(times);
}

/** Every field that reaches the DOM, each carrying the payload it was given. */
function projectWith(payload: string): ProjectCard {
  return projectCard({
    id: payload,
    name: payload,
    repo: payload,
    lastPush: payload,
  });
}

/**
 * Every lane field that reaches the DOM, each carrying the payload. The event,
 * the pull-request state and the pull-request checks are contract values, so
 * the payload is cast in: the point of the test is that the UI renders whatever
 * arrives rather than leaning on the server having validated it.
 */
function laneWith(payload: string): LaneView {
  return lane({
    id: payload,
    seat: payload,
    reported: {
      stage: payload,
      event: payload as LaneEvent,
      ts: payload,
      pr: 1,
      round: 1,
      detail: { note: payload },
    },
    derived: {
      alive: true,
      pr: {
        number: 1,
        state: payload as PullRequestState,
        checks: payload as CheckStatus,
        unresolvedThreads: 1,
      },
      planReview: payload,
      risk: payload,
      log: { bytes: 1, mtimeMs: 0, tail: payload },
    },
    disagreements: [payload],
  });
}

function hostileView(payload: string) {
  return {
    envelope: {
      schema: "waves/v1" as const,
      project: payload,
      wave: payload,
      generatedAt: payload,
      intervalSeconds: 30,
      lanes: [laneWith(payload)],
    },
    receivedAt: payload,
    stale: true,
    staleAfterMs: 1,
  };
}

describe("the project list against stored markup", () => {
  it("renders every field of every card as text", () => {
    for (const payload of TEXT_PAYLOADS) {
      freshRoot();
      const host = document.getElementById("root") as HTMLElement;
      host.append(projectList([projectWith(payload)], NOW_MS));
      assertNoInjectedMarkup();
      expect(host.querySelectorAll("img")).toHaveLength(0);
      expect(host.querySelectorAll("script")).toHaveLength(0);
      expect(textsOf(host, "h2 a")).toStrictEqual([payload]);
      expect(textsOf(host, "code")).toStrictEqual([payload]);
      expect(textsOf(host, "dd span[title]")).toStrictEqual(["unknown"]);
      expectVerbatim(payload, CARD_OCCURRENCES);
    }
  });

  it("never turns a hostile repository into a link", () => {
    for (const payload of REPO_PAYLOADS) {
      freshRoot();
      const host = document.getElementById("root") as HTMLElement;
      host.append(projectList([projectCard({ repo: payload })], NOW_MS));
      assertNoInjectedMarkup();
      expect(host.querySelectorAll("a[href^='javascript:']")).toHaveLength(0);
      expect(host.querySelectorAll("a[href^='data:']")).toHaveLength(0);
      expect(host.querySelectorAll("a[href*='@']")).toHaveLength(0);
      expect(textsOf(host, "dd")[1]).toBe(payload);
      expectVerbatim(payload, 1);
    }
  });

  it("keeps a hostile project id out of the link it builds", () => {
    freshRoot();
    const host = document.getElementById("root") as HTMLElement;
    host.append(projectList([projectCard({ id: SCRIPT })], NOW_MS));
    assertNoInjectedMarkup();
    expect(host.querySelector("h2 a")?.getAttribute("href")).toBe(
      "/p/%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E",
    );
    expectVerbatim(SCRIPT, 1);
  });
});

describe("the wave panel against stored markup", () => {
  it("renders every field of a lane as text", () => {
    for (const payload of TEXT_PAYLOADS) {
      freshRoot();
      const host = document.getElementById("root") as HTMLElement;
      host.append(
        wavePanel(
          {
            project: payload,
            waves: [waveSummary({ wave: payload, receivedAt: payload })],
            showAll: true,
            selected: payload,
            view: hostileView(payload),
          },
          NOW_MS,
          { onSelect: () => undefined, onToggleAll: () => undefined },
        ),
      );
      assertNoInjectedMarkup();
      expect(host.querySelectorAll("img")).toHaveLength(0);
      expect(host.querySelectorAll("script")).toHaveLength(0);
      expect(host.querySelectorAll("details").length).toBe(1);
      expectVerbatim(payload, LANE_OCCURRENCES);
    }
  });

  it("renders the pull request and the reported stage and event as text", () => {
    for (const payload of TEXT_PAYLOADS) {
      freshRoot();
      const host = document.getElementById("root") as HTMLElement;
      host.append(
        wavePanel(
          {
            project: "alpha",
            waves: [waveSummary()],
            showAll: false,
            selected: "w-3",
            view: hostileView(payload),
          },
          NOW_MS,
          { onSelect: () => undefined, onToggleAll: () => undefined },
        ),
      );
      assertNoInjectedMarkup();
      expect(textsOf(host, "td[data-label='pr']")).toStrictEqual([
        `#1 ${payload} · checks ${payload} · 1 open thread`,
      ]);
      const reported = textsOf(host, "td[data-label='reported']")[0] ?? "";
      expect(reported.startsWith(`${payload} · ${payload}`)).toBe(true);
      expect(reported).toContain(`note: ${payload}`);
    }
  });

  it("keeps a payload in the tail from closing the details element", () => {
    freshRoot();
    const host = document.getElementById("root") as HTMLElement;
    host.append(
      wavePanel(
        {
          project: "alpha",
          waves: [waveSummary()],
          showAll: false,
          selected: "w-3",
          view: {
            envelope: {
              schema: "waves/v1",
              project: "alpha",
              wave: "w-3",
              generatedAt: NOW_ISO,
              intervalSeconds: 30,
              lanes: [
                lane({
                  derived: {
                    alive: true,
                    log: { bytes: 1, mtimeMs: 0, tail: CLOSING_DETAILS },
                  },
                }),
              ],
            },
            receivedAt: NOW_ISO,
            stale: false,
            staleAfterMs: 1,
          },
        },
        NOW_MS,
        { onSelect: () => undefined, onToggleAll: () => undefined },
      ),
    );
    assertNoInjectedMarkup();
    expect(host.querySelectorAll("details")).toHaveLength(1);
    expect(host.querySelectorAll("details > *")).toHaveLength(2);
    expect(textsOf(host, "pre")).toStrictEqual([CLOSING_DETAILS]);
    expectVerbatim(CLOSING_DETAILS, 1);
  });
});
