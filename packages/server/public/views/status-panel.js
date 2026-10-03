import { el, stamp, text } from "../dom.js";

/**
 * The one panel that shows what a project last said about itself: the pull-request
 * rows its last listing could not read, and what its last `plan:verify` artifact
 * said. It is a panel of its own rather than another column of the lane table,
 * because none of this is about a lane and none of it changes when the reader
 * filters the table.
 *
 * It draws the document it is handed and nothing else: the app has already held
 * the answer to `drawableStatus`, so every string below reaches the document as
 * `textContent` and the only class names are this file's own literals.
 *
 * There is deliberately no stale badge. The contract caps a status's staleness
 * window at 300 s, and a project that pushes a status once per run would read
 * stale nearly every time a reader looked — so the panel shows when the document
 * arrived, which is the fact behind the badge, and never a warning the reader
 * cannot act on. The API still answers `stale` and `staleAfterMs`; a client that
 * wants the rule has it.
 */

/**
 * The badge class each of the four premise statuses gets, and the one every other
 * value falls back to. The class is chosen from this table and never built from
 * the value itself: a class assembled from a pusher's string is an attribute a
 * pusher wrote, which is the one thing this page does not do. `premise-unknown`
 * is also what a value the contract refuses has to be drawn as, so a document that
 * arrived outside the check is still a panel rather than markup.
 *
 * The lookup is `Object.hasOwn` rather than a bare index: a plain object literal
 * answers `constructor` and `toString` out of its prototype, so a bare index
 * would hand one of those to `setAttribute` as a class rather than falling back —
 * and the fallback is the whole point of the table.
 */
export const PREMISE_CLASS = {
  holds: "badge premise-holds",
  stale: "badge premise-stale",
  "timed-out": "badge premise-timed-out",
  error: "badge premise-error",
};

const PREMISE_FALLBACK = "badge premise-unknown";

/** What the panel says about pull requests it could not read, either way. */
const PRS_ALL_READ = "every PR row read";

/** What a backlog the document did not carry is called. */
const NOTHING_RECORDED = "nothing recorded";

/** The four columns of the premises table, in the order they are shown. */
const PREMISE_COLUMNS = ["Lane", "Plan", "Status", "Reason"];

/** What a premise with no reason recorded is called. */
const NO_REASON = "—";

/** One premise's status: the value as text, the class from the fixed table. */
function premiseBadge(status) {
  const known = Object.hasOwn(PREMISE_CLASS, status);
  return el("span", {
    attrs: { class: known ? PREMISE_CLASS[status] : PREMISE_FALLBACK },
    text: status,
  });
}

function cell(label, children) {
  return el("td", { attrs: { "data-label": label }, children });
}

/**
 * The premises as a table, one row each. It is a table rather than a list because
 * a premise is four facts about one row of an artifact, and a reader comparing
 * two of them wants them side by side.
 */
function premisesTable(premises) {
  return el("table", {
    attrs: { class: "premises" },
    children: [
      el("thead", {
        children: [
          el("tr", {
            children: PREMISE_COLUMNS.map((label) =>
              el("th", { attrs: { scope: "col" }, text: label }),
            ),
          }),
        ],
      }),
      el("tbody", {
        children: premises.map((premise) =>
          el("tr", {
            children: [
              cell("Lane", [el("code", { text: premise.lane })]),
              cell("Plan", [text(premise.plan)]),
              cell("Status", [premiseBadge(premise.status)]),
              cell("Reason", [
                text(premise.reason === undefined ? NO_REASON : premise.reason),
              ]),
            ],
          }),
        ),
      }),
    ],
  });
}

/**
 * The backlog half: its state, when the artifact was written, which plans it
 * covers and at what scope, the branch and commit it saw, and its premises. Every
 * optional half is left out rather than written down as nothing — an artifact that
 * carried no `git` has not said anything about a branch, and a `git: unknown` line
 * would be the panel claiming something the server never sent.
 */
function backlogSection(backlog, nowMs) {
  const children = [text(backlog.state)];
  if (backlog.at !== undefined) {
    children.push(text(" · "), stamp(backlog.at, nowMs));
  }
  if (backlog.scope !== undefined) {
    children.push(text(` · ${backlog.scope.kind}`));
  }
  if (backlog.git !== undefined) {
    children.push(text(" · "));
    children.push(el("code", { text: backlog.git.branch }));
    children.push(text(" @ "));
    children.push(el("code", { text: backlog.git.head }));
  }
  const block = [el("p", { children })];
  if (backlog.scope !== undefined) {
    block.push(
      el("ul", {
        attrs: { class: "plans" },
        children: backlog.scope.plans.map((plan) => el("li", { text: plan })),
      }),
    );
  }
  if (backlog.premises !== undefined) {
    block.push(premisesTable(backlog.premises));
  }
  return el("div", { attrs: { class: "backlog" }, children: block });
}

/** The whole panel, for a status the app has already held to its shape. */
export function renderStatusPanel(view, nowMs) {
  const status = view.status;
  const children = [
    el("h2", { text: "Status" }),
    el("p", { children: [stamp(view.receivedAt, nowMs)] }),
  ];
  if (status.prs !== undefined) {
    children.push(
      el("p", {
        attrs: { class: "prs" },
        text:
          status.prs.skipped > 0
            ? `${status.prs.skipped} PR rows could not be read`
            : PRS_ALL_READ,
      }),
    );
  }
  children.push(
    el("div", {
      attrs: { class: "status-backlog" },
      children: [
        el("h3", { text: "Backlog" }),
        status.backlog === undefined
          ? el("p", { attrs: { class: "panel-empty" }, text: NOTHING_RECORDED })
          : backlogSection(status.backlog, nowMs),
      ],
    }),
  );
  return el("section", { attrs: { class: "panel status" }, children });
}
