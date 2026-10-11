import { describe, expect, it } from "vitest";

import type { AppGlobals } from "../../public/app.js";
import { createApp } from "../../public/app.js";
import { ANSWER_FOOTER } from "../../public/views/answer.js";

import {
  attentionView,
  decisionResponse,
  decisionRevision,
  inboxHead,
  projectCard,
  storedRevision,
} from "./fixtures.js";
import type { Answer } from "./helpers.js";
import {
  browserGlobals,
  flush,
  freshRoot,
  root,
  textsOf,
  timerStub,
} from "./helpers.js";

const NONCE = (id: string) => `/api/v1/projects/alpha/decisions/${id}/nonce`;
const DECISION = (id: string) => `/api/v1/projects/alpha/decisions/${id}`;

/** A fetch that records `METHOD path` and answers by path; `probe` answers the nonce path. */
function answerFetch(options: {
  decisions: Record<string, unknown>;
  probe: (id: string) => Promise<Answer>;
}) {
  const calls: string[] = [];
  const impl = async (
    path: string,
    init?: { method?: string; headers?: Readonly<Record<string, string>> },
  ) => {
    calls.push(`${init?.method ?? "GET"} ${path}`);
    let answer: Answer = { status: 404 };
    if (path === "/api/v1/projects") {
      answer = { status: 200, body: [projectCard()] };
    } else if (path === "/api/v1/attention") {
      answer = { status: 200, body: attentionView() };
    } else {
      for (const [id, body] of Object.entries(options.decisions)) {
        if (path === NONCE(id)) {
          answer = await options.probe(id);
        } else if (path === DECISION(id)) {
          answer = { status: 200, body };
        }
      }
    }
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: () => Promise.resolve(answer.body),
    };
  };
  return Object.assign(impl, { calls });
}

function harness(pathname: string, fetchImpl: ReturnType<typeof answerFetch>) {
  freshRoot();
  const timers = timerStub();
  const browser = browserGlobals(pathname, "");
  const app = createApp({
    doc: document,
    location: browser.location,
    history: browser.history,
    win: browser.win,
    fetch: fetchImpl,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    clock: () => Date.parse("2026-04-01T12:00:00.000Z"),
  } satisfies AppGlobals);
  return { app, browser, timers };
}

async function load(h: ReturnType<typeof harness>, flushes = 2): Promise<void> {
  h.app.start();
  for (let i = 0; i < flushes; i++) {
    await flush();
  }
}

describe("the decision page offers answer controls only when the server takes answers", () => {
  it("is dark when answers are off, and identical to not knowing", async () => {
    const body = decisionResponse({});

    const off: (id: string) => Promise<Answer> = async () => ({
      status: 404,
    });
    const rejecting: (id: string) => Promise<Answer> = async () => {
      throw new Error("network");
    };
    const never: (id: string) => Promise<Answer> = () =>
      new Promise<Answer>(() => {});

    const html: string[] = [];
    for (const probe of [off, rejecting, never]) {
      const fetchImpl = answerFetch({ decisions: { d1: body }, probe });
      const h = harness("/p/alpha/d/d1", fetchImpl);
      await load(h);
      html.push(root().innerHTML);
      expect(root().querySelector("section.decision button")).toBeNull();
      expect(root().innerHTML).not.toContain('class="answer"');
      h.app.stop();
    }

    expect(html[0]).toBe(html[1]);
    expect(html[1]).toBe(html[2]);
  });

  it("shows the answer controls when the server takes answers", async () => {
    const body = decisionResponse({
      revisions: [
        storedRevision({
          decision: decisionRevision({
            commits: ["the owner is bound to the outcome"],
            evidence: [
              { label: "evidence", href: "https://ev.example.test/x" },
            ],
          }),
        }),
      ],
    });
    const fetchImpl = answerFetch({
      decisions: { d1: body },
      probe: async () => ({ status: 405 }),
    });
    const h = harness("/p/alpha/d/d1", fetchImpl);
    await load(h);

    expect(textsOf(root(), "section.answer button")).toEqual([
      "Yes",
      "No",
      "Answer in my own words",
    ]);
    expect(root().querySelector(".decision-footer")?.textContent).toBe(
      ANSWER_FOOTER,
    );

    const answer = root().querySelector("section.answer");
    const commits = root().querySelector(".decision-commits");
    const evidence = root().querySelector(".decision-evidence");
    expect(answer).not.toBeNull();
    expect(commits).not.toBeNull();
    expect(evidence).not.toBeNull();
    expect(
      answer!.compareDocumentPosition(commits!) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).not.toBe(0);
    expect(
      answer!.compareDocumentPosition(evidence!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);

    h.app.stop();
  });

  it("shows the closed note, not the controls, for a one-way door", async () => {
    const body = decisionResponse({
      head: inboxHead({ door: { value: true } }),
      revisions: [
        storedRevision({
          decision: decisionRevision({
            hardToUndo: { value: true, reason: "one-way door" },
          }),
        }),
      ],
    });

    const darkFetch = answerFetch({
      decisions: { d1: body },
      probe: async () => ({ status: 404 }),
    });
    const dark = harness("/p/alpha/d/d1", darkFetch);
    await load(dark);
    const darkFooter =
      root().querySelector(".decision-footer")?.textContent ?? "";
    dark.app.stop();

    const onFetch = answerFetch({
      decisions: { d1: body },
      probe: async () => ({ status: 405 }),
    });
    const on = harness("/p/alpha/d/d1", onFetch);
    await load(on);

    expect(root().querySelector("section.answer")).toBeNull();
    expect(textsOf(root(), "section.answer button")).toEqual([]);
    expect(root().querySelectorAll("p.answer-closed")).toHaveLength(1);
    const onFooter =
      root().querySelector(".decision-footer")?.textContent ?? "";
    expect(onFooter).toBe(darkFooter);
    expect(onFooter).not.toBe(ANSWER_FOOTER);

    on.app.stop();
  });

  it("draws nothing extra for the closed and act-elsewhere reasons", async () => {
    const closed = decisionResponse({
      head: inboxHead({ group: "closed", state: "withdrawn" }),
    });
    const elsewhere = decisionResponse({
      head: inboxHead({
        actElsewhere: { where: "terminal", what: "answer the relay" },
      }),
      revisions: [
        storedRevision({
          decision: decisionRevision({
            actElsewhere: { where: "terminal", what: "answer the relay" },
          }),
        }),
      ],
    });

    for (const body of [closed, elsewhere]) {
      const darkFetch = answerFetch({
        decisions: { d1: body },
        probe: async () => ({ status: 404 }),
      });
      const dark = harness("/p/alpha/d/d1", darkFetch);
      await load(dark);
      const darkHtml = root().innerHTML;
      dark.app.stop();

      const onFetch = answerFetch({
        decisions: { d1: body },
        probe: async () => ({ status: 405 }),
      });
      const on = harness("/p/alpha/d/d1", onFetch);
      await load(on);
      const onHtml = root().innerHTML;
      expect(onHtml).toBe(darkHtml);
      expect(root().querySelector("section.answer")).toBeNull();
      expect(textsOf(root(), "section.answer button")).toEqual([]);
      on.app.stop();
    }
  });

  it("asks the answer probe once, and only on the decision route", async () => {
    const body1 = decisionResponse({});
    const body2 = decisionResponse({
      head: inboxHead({ id: "d2" }),
      revisions: [storedRevision({ decision: decisionRevision({ id: "d2" }) })],
    });
    const fetchImpl = answerFetch({
      decisions: { d1: body1, d2: body2 },
      probe: async () => ({ status: 405 }),
    });
    const h = harness("/p/alpha/d/d1", fetchImpl);
    h.app.start();
    await flush();
    for (let i = 0; i < 3; i++) {
      h.timers.runLast();
      await flush();
    }

    const nonceCalls = (id: string) =>
      fetchImpl.calls.filter((c) => c === `GET ${NONCE(id)}`).length;
    expect(nonceCalls("d1")).toBe(1);
    expect(fetchImpl.calls.some((c) => c.startsWith("POST"))).toBe(false);

    h.app.navigate("/p/alpha/d/d2");
    await flush();
    expect(nonceCalls("d2")).toBe(1);

    h.app.navigate("/");
    await flush();
    expect(nonceCalls("d1")).toBe(1);
    expect(nonceCalls("d2")).toBe(1);

    h.app.stop();
  });

  it("does not draw answer controls when the probe settles after the reader has left", async () => {
    const body1 = decisionResponse({});
    const body2 = decisionResponse({
      head: inboxHead({ id: "d2" }),
      revisions: [storedRevision({ decision: decisionRevision({ id: "d2" }) })],
    });

    let resolveProbe!: (a: Answer) => void;
    const probe = (id: string): Promise<Answer> => {
      if (id === "d1") {
        return new Promise<Answer>((resolve) => {
          resolveProbe = resolve;
        });
      }
      return Promise.resolve({ status: 404 });
    };

    const fetchImpl = answerFetch({
      decisions: { d1: body1, d2: body2 },
      probe,
    });
    const h = harness("/p/alpha/d/d1", fetchImpl);
    h.app.start();
    await flush();
    expect(root().querySelector("section.answer")).toBeNull();

    h.app.navigate("/");
    await flush();
    resolveProbe({ status: 405 });
    await flush();
    expect(root().querySelector("section.answer")).toBeNull();

    h.app.navigate("/p/alpha/d/d2");
    await flush();
    await flush();
    expect(root().querySelector("section.answer")).toBeNull();

    h.app.stop();
  });
});
