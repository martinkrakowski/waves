import { describe, expect, it } from "vitest";

import type { Status } from "../../public/status.js";
import {
  PREMISE_CLASS,
  renderStatusPanel,
} from "../../public/views/status-panel.js";

import { NOW_ISO, NOW_MS, statusView } from "./fixtures.js";
import {
  assertNoInjectedMarkup,
  freshRoot,
  oneOf,
  textOf,
  textsOf,
} from "./helpers.js";

/**
 * Draws one status the panel is handed, straight to the document. The view is
 * pure and the app is what holds an answer to `drawableStatus`, so this file can
 * hand it a document the check would have refused — which is the only way to see
 * what the panel does with a value it was never meant to draw.
 */
function panel(view: Status): HTMLElement {
  const host = freshRoot();
  host.append(renderStatusPanel(view, NOW_MS));
  assertNoInjectedMarkup();
  return host;
}

/** One status with the document handed to the caller to change. */
function withDocument(
  change: (document: Record<string, unknown>) => void,
): Status {
  const view = statusView();
  change(view.status as unknown as Record<string, unknown>);
  return view;
}

/** The exact `title` attributes of every stamp under a node. */
function titles(node: Element, selector: string): (string | null)[] {
  return Array.from(node.querySelectorAll(selector), (element) =>
    element.getAttribute("title"),
  );
}

describe("the status panel", () => {
  it("shows the heading, the received time and nothing stale", () => {
    const host = panel(statusView({ stale: true }));

    expect(oneOf(host, "section.panel.status")).not.toBeNull();
    expect(textsOf(host, ".panel.status h2")).toStrictEqual(["Status"]);
    // The receive time is the fact a stale badge would have been standing in for,
    // and the badge is not drawn: the document's own window is capped at 300 s,
    // so a status pushed once a run would read stale nearly every time.
    expect(titles(host, ".panel.status span[title]")[0]).toBe(NOW_ISO);
    expect(textsOf(host, ".panel.status span[title]")[0]).toBe("just now");
    expect(host.querySelectorAll(".panel.status .badge.stale")).toHaveLength(0);
  });

  it("says the pull-request rows it could not read, either way", () => {
    expect(textsOf(panel(statusView()), ".panel.status p.prs")).toStrictEqual([
      "2 PR rows could not be read",
    ]);

    const nothing = withDocument((document) => (document.prs = { skipped: 0 }));
    expect(textsOf(panel(nothing), ".panel.status p.prs")).toStrictEqual([
      "every PR row read",
    ]);
  });

  it("leaves out a prs half the document never carried", () => {
    const silent = withDocument((document) => (document.prs = undefined));

    expect(panel(silent).querySelectorAll(".panel.status p.prs")).toHaveLength(
      0,
    );
  });

  it("says the backlog's state, when it was written, and its scope", () => {
    const host = panel(statusView());
    const line = textsOf(host, ".panel.status .backlog p")[0] ?? "";

    expect(line).toMatch(/^recorded · /);
    expect(line).toContain("full");
    expect(titles(host, ".panel.status .backlog span[title]")).toContain(
      "2026-04-01T11:40:00.000Z",
    );
    expect(textsOf(host, ".panel.status .plans li")).toStrictEqual([
      "plan:verify",
    ]);
  });

  it("shows the branch and the commit as code", () => {
    const host = panel(statusView());

    expect(textsOf(host, ".panel.status .backlog p code")).toStrictEqual([
      "main",
      "0a1b2c3d4e5f60718293a4b5c6d7e8f9",
    ]);
  });

  it("leaves out every optional half the document did not carry", () => {
    const host = panel(
      withDocument((document) => (document.backlog = { state: "unknown" })),
    );

    expect(textsOf(host, ".panel.status .backlog p")).toStrictEqual([
      "unknown",
    ]);
    expect(host.querySelectorAll(".panel.status .plans")).toHaveLength(0);
    expect(host.querySelectorAll(".panel.status .premises")).toHaveLength(0);
    expect(host.querySelectorAll(".panel.status .backlog p code")).toHaveLength(
      0,
    );
  });

  it("says a document that carried no backlog at all", () => {
    const host = panel(
      withDocument((document) => (document.backlog = undefined)),
    );

    expect(
      textsOf(host, ".panel.status .status-backlog p.panel-empty"),
    ).toStrictEqual(["nothing recorded"]);
    expect(host.querySelectorAll(".panel.status .backlog")).toHaveLength(0);
  });

  it("draws the premises as a table of four named columns", () => {
    const table = oneOf(
      panel(statusView()),
      ".panel.status .premises",
    ) as Element;

    expect(textsOf(table, "thead th")).toStrictEqual([
      "Lane",
      "Plan",
      "Status",
      "Reason",
    ]);
    expect(
      Array.from(table.querySelectorAll("thead th")).map((cell) =>
        cell.getAttribute("scope"),
      ),
    ).toStrictEqual(["col", "col", "col", "col"]);
    expect(textsOf(table, "tbody tr")).toStrictEqual([
      "C1plan:verifyholds—",
      "C2plan:verifytimed-outno push since 06:00",
    ]);
  });

  it("says a premise with no reason as a dash, not as nothing", () => {
    const host = panel(
      withDocument((document) => {
        document.backlog = {
          state: "recorded",
          premises: [{ lane: "C1", plan: "p", status: "holds" }],
        };
      }),
    );

    expect(
      textsOf(host, '.panel.status td[data-label="Reason"]'),
    ).toStrictEqual(["—"]);
  });

  it.each(["holds", "stale", "timed-out", "error"])(
    "gives a premise of status %s its own class",
    (status) => {
      const host = panel(
        withDocument((document) => {
          document.backlog = {
            state: "recorded",
            premises: [{ lane: "C1", plan: "p", status }],
          };
        }),
      );

      const badge = oneOf(host, '.panel.status td[data-label="Status"] span');
      expect(badge?.getAttribute("class")).toBe(PREMISE_CLASS[status]);
      expect(textOf(badge)).toBe(status);
    },
  );

  it("falls back to a fixed class for a status outside the four", () => {
    // A value the check would have refused: the panel still draws it, still as
    // text, and with a class out of its own table rather than one this string
    // built.
    const payload = "<img src=x onerror=alert(1)>";
    const host = panel(
      withDocument((document) => {
        document.backlog = {
          state: "recorded",
          premises: [{ lane: "C1", plan: "p", status: payload }],
        };
      }),
    );

    const badge = oneOf(host, '.panel.status td[data-label="Status"] span');
    expect(badge?.getAttribute("class")).toBe("badge premise-unknown");
    expect(textOf(badge)).toBe(payload);
    expect(host.querySelectorAll("img")).toHaveLength(0);
    expect(host.querySelectorAll("script")).toHaveLength(0);
  });

  it("does not answer a prototype key out of the class table", () => {
    // A bare `PREMISE_CLASS[status]` would hand `constructor` — a function — to
    // `setAttribute` as a class instead of falling back, which is why the lookup
    // asks whether the key is its own.
    for (const status of ["constructor", "toString", "hasOwnProperty"]) {
      const host = panel(
        withDocument((document) => {
          document.backlog = {
            state: "recorded",
            premises: [{ lane: "C1", plan: "p", status }],
          };
        }),
      );

      const badge = oneOf(host, '.panel.status td[data-label="Status"] span');
      expect(badge?.getAttribute("class")).toBe("badge premise-unknown");
    }
  });
});
