import { describe, expect, it } from "vitest";

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
const REPO_PAYLOADS = [
  "javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
] as const;

const TEXT_PAYLOADS = [IMG, SCRIPT, HANDLER, CLOSING_DETAILS] as const;

function documentText(): string {
  return document.body.textContent ?? "";
}

function expectVerbatim(payload: string): void {
  expect(documentText()).toContain(payload);
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

function laneWith(payload: string): LaneView {
  return lane({
    id: payload,
    seat: payload,
    reported: {
      stage: payload,
      event: "settled",
      ts: payload,
      pr: 1,
      round: 1,
      detail: { note: payload, [payload]: payload },
    },
    derived: {
      alive: true,
      pr: { number: 1, state: "open", checks: "pass", unresolvedThreads: 1 },
      planReview: payload,
      risk: payload,
      log: { bytes: 1, mtimeMs: 0, tail: payload },
    },
    disagreements: [payload, payload],
  });
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
      expectVerbatim(payload);
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
      expect(textsOf(host, "dd")[1]).toBe(payload);
      expectVerbatim(payload);
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
    expectVerbatim(SCRIPT);
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
            view: {
              envelope: {
                schema: "waves/v1",
                project: payload,
                wave: payload,
                generatedAt: payload,
                intervalSeconds: 30,
                lanes: [laneWith(payload)],
              },
              receivedAt: payload,
              stale: true,
              staleAfterMs: 1,
            },
          },
          NOW_MS,
          { onSelect: () => undefined, onToggleAll: () => undefined },
        ),
      );
      assertNoInjectedMarkup();
      expect(host.querySelectorAll("img")).toHaveLength(0);
      expect(host.querySelectorAll("script")).toHaveLength(0);
      expect(host.querySelectorAll("details").length).toBe(1);
      expectVerbatim(payload);
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
  });
});
