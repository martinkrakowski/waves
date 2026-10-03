import { el, httpsUrl, repoLink, stamp, text } from "../dom.js";
import {
  aliveView,
  detailValue,
  diffText,
  gateText,
  pullRequestText,
  reportedText,
} from "../format.js";

/**
 * One lane's drawer: everything the service holds about it, beside what the
 * last push could derive. It reads the model it is handed and answers nodes, so
 * a lane id, a seat, a disagreement, a `detail` key and its value and the log
 * tail — all of which another project chose — reach the document as
 * `textContent` and as nothing else.
 *
 * The wording is the project's own wherever `format.js` has it, so the drawer
 * and the table say the same thing in the same words about the same lane.
 */

/** The word a cell uses for the half that has nothing to say. */
const NOTHING = "—";

/** The four states the drawer can be in before it has anything to draw. */
const STATE_TEXT = {
  loading: "Loading…",
  failed: "This lane could not be read. Close and open it again to retry.",
  gone: "This wave is no longer held by the service.",
  missing: "This wave holds no lane with this id.",
};

const NO_SEAT = "no seat recorded";
const NOTHING_TO_AGREE = "Reported and derived agree.";
const NO_TAIL = "No log tail was pushed.";

/**
 * One path segment of a GitHub repository: the alphabet GitHub accepts for an
 * owner and a repository name, with `.` and `..` refused — they are inside that
 * alphabet and name nothing. It holds no percent-escape either, so a repository
 * written to smuggle a quote or an event handler into a URL cannot pass here.
 */
const SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9_.-]+$/;

function badge(label, kind) {
  return el("span", { attrs: { class: `badge ${kind}` }, text: label });
}

function section(heading, ...children) {
  return el("section", {
    children: [el("h3", { text: heading }), ...children],
  });
}

/** A term and what the service holds for it: the two children of a `dl`. */
function fact(term, children) {
  return [el("dt", { text: term }), el("dd", { children })];
}

/**
 * The pull request's address, or nothing. Every condition here is a way a URL
 * could mean something other than "this repository on GitHub": another host that
 * ends in the same name, a query or a fragment the reader did not choose, a
 * path that is not an owner and a repository, a `.git` suffix a clone URL
 * carries and a pull request address does not, and a number that is not one.
 */
export function prUrl(repo, number) {
  const href = httpsUrl(repo);
  if (href === undefined) {
    return undefined;
  }
  // `httpsUrl` parsed this once already and handed back its own `href`, so
  // parsing it again cannot throw: only the fields are worth reading now.
  const url = new URL(href);
  if (url.hostname !== "github.com" || url.search !== "" || url.hash !== "") {
    return undefined;
  }
  const segments = url.pathname.split("/").filter((part) => part !== "");
  if (segments.length !== 2) {
    return undefined;
  }
  const [owner, name] = segments;
  if (!SEGMENT.test(owner) || !SEGMENT.test(name)) {
    return undefined;
  }
  if (name.endsWith(".git")) {
    return undefined;
  }
  if (
    typeof number !== "number" ||
    !Number.isSafeInteger(number) ||
    number <= 0
  ) {
    return undefined;
  }
  return `https://github.com/${owner}/${name}/pull/${number}`;
}

/** The lane id, the wave it is in, and the one control that closes the drawer. */
function drawerHeader(model, handlers) {
  const close = el("button", {
    attrs: { type: "button", "data-key": "close", class: "close" },
    text: "Close",
  });
  close.addEventListener("click", () => {
    handlers.onClose();
  });
  return el("header", {
    children: [
      el("h2", { attrs: { id: "drawer-title" }, text: model.lane }),
      el("code", { text: model.wave }),
      close,
    ],
  });
}

/** The seat, or the absence of one, and whether this wave is past its interval. */
function seatLine(lane, stale) {
  const children = [text(lane.seat ?? NO_SEAT)];
  if (stale) {
    children.push(badge("stale", "stale"));
  }
  return el("p", { attrs: { class: "meta seat" }, children });
}

function reasonsSection(reasons) {
  return section(
    "Needs attention",
    el("p", { children: reasons.map((reason) => badge(reason, "reason")) }),
  );
}

/**
 * The lane's own list of what the two halves of a push did not agree on. The
 * class is the page's own name for the list, and `drawer.css` draws it under
 * `.lane-drawer` — the project page has a list of its own by the same name.
 */
function disagreementsSection(lane) {
  if (lane.disagreements.length === 0) {
    return section(
      "Disagreements",
      el("p", { attrs: { class: "panel-empty" }, text: NOTHING_TO_AGREE }),
    );
  }
  return section(
    "Disagreements",
    el("ul", {
      attrs: { class: "disagreements" },
      children: lane.disagreements.map((entry) => el("li", { text: entry })),
    }),
  );
}

function factRow(label, reported, derived) {
  return el("tr", {
    children: [
      el("th", { attrs: { scope: "row" }, text: label }),
      el("td", { children: [reported] }),
      el("td", { children: [derived] }),
    ],
  });
}

/**
 * What the pusher said beside what the service worked out, one row per fact the
 * contract carries on both halves. A half that reported nothing says so rather
 * than leaving the reader to work out which column is empty.
 */
function compareSection(lane, view, nowMs) {
  const reported = lane.reported;
  const derived = lane.derived;
  const received = el("span", {
    children: [text("received "), stamp(view.receivedAt, nowMs)],
  });
  return section(
    "Reported and derived",
    el("table", {
      children: [
        el("thead", {
          children: [
            el("tr", {
              children: [
                el("th"),
                el("th", { text: "Reported" }),
                el("th", { text: "Derived" }),
              ],
            }),
          ],
        }),
        el("tbody", {
          children: [
            factRow("Stage", text(reportedText(reported)), text(NOTHING)),
            factRow(
              "Reported at",
              reported === undefined
                ? text(NOTHING)
                : stamp(reported.ts, nowMs),
              received,
            ),
            factRow(
              "Alive",
              text(NOTHING),
              text(aliveView(derived.alive).label),
            ),
            factRow(
              "Exit",
              text(NOTHING),
              text(derived.exit === undefined ? NOTHING : String(derived.exit)),
            ),
            factRow(
              "PR",
              text(reported?.pr === undefined ? NOTHING : `#${reported.pr}`),
              text(
                derived.pr === undefined
                  ? NOTHING
                  : pullRequestText(derived.pr),
              ),
            ),
            factRow(
              "Gate",
              text(NOTHING),
              text(
                derived.gate === undefined ? NOTHING : gateText(derived.gate),
              ),
            ),
          ],
        }),
      ],
    }),
  );
}

/** The lane's pull request on the project's repository, when both are known. */
function linksLine(model, lane) {
  const number = lane.derived.pr?.number ?? lane.reported?.pr;
  const href = prUrl(model.repo, number);
  if (href === undefined) {
    return undefined;
  }
  return el("p", {
    children: [repoLink(`Pull request #${number} on GitHub`, href)],
  });
}

/**
 * The log's size, and how long ago it was written when that can be read. The
 * space after the size is part of the line: the stamp is a second node beside
 * it, and without the space the two read as one word.
 */
function logFact(log, nowMs) {
  const children = [text(`${log.bytes} bytes `)];
  const at = new Date(log.mtimeMs);
  if (Number.isNaN(at.getTime())) {
    return fact("Log", children);
  }
  children.push(stamp(at.toISOString(), nowMs));
  return fact("Log", children);
}

function summarySection(lane, nowMs) {
  const derived = lane.derived;
  const facts = [];
  if (derived.diff !== undefined) {
    facts.push(fact("Diff", [text(diffText(derived.diff))]));
  }
  if (derived.log !== undefined) {
    facts.push(logFact(derived.log, nowMs));
  }
  if (derived.planReview !== undefined) {
    facts.push(fact("Plan review", [text(derived.planReview)]));
  }
  if (derived.risk !== undefined) {
    facts.push(fact("Risk", [text(derived.risk)]));
  }
  if (facts.length === 0) {
    return undefined;
  }
  // `fact` answers a pair, and `children` takes nodes: a list of pairs is
  // flattened here rather than left for `append` to turn into a string.
  return section("Summary", el("dl", { children: facts.flat() }));
}

/**
 * The pusher's own words about this lane, one term per key. A `detail` of `null`
 * throws here, which is the app's answer to a shape it could not read rather
 * than a half-drawn drawer: the service's own check bounds what a detail holds,
 * so a `null` means the stored lane is not the shape the contract describes.
 */
function detailSection(lane) {
  const detail = lane.reported?.detail;
  if (detail === undefined || Object.keys(detail).length === 0) {
    return undefined;
  }
  return section(
    "Reported detail",
    el("dl", {
      children: Object.keys(detail).flatMap((key) =>
        fact(key, [text(detailValue(detail[key]))]),
      ),
    }),
  );
}

function logTailSection(lane) {
  const tail = lane.derived.log?.tail;
  const body =
    typeof tail === "string"
      ? el("pre", { text: tail })
      : el("p", { attrs: { class: "panel-empty" }, text: NO_TAIL });
  return section("Log tail", body);
}

/** Everything a reader came for, once the wave behind the lane has answered. */
function drawerBody(model, nowMs) {
  if (model.state !== "ready") {
    return [
      el("p", {
        attrs: { class: "panel-empty" },
        text: STATE_TEXT[model.state],
      }),
    ];
  }
  const view = model.view;
  const lane = view.envelope.lanes.find((entry) => entry.id === model.lane);
  const children = [seatLine(lane, view.stale)];
  if (model.reasons.length > 0) {
    children.push(reasonsSection(model.reasons));
  }
  children.push(disagreementsSection(lane), compareSection(lane, view, nowMs));
  const links = linksLine(model, lane);
  if (links !== undefined) {
    children.push(links);
  }
  const summary = summarySection(lane, nowMs);
  if (summary !== undefined) {
    children.push(summary);
  }
  const detail = detailSection(lane);
  if (detail !== undefined) {
    children.push(detail);
  }
  children.push(logTailSection(lane));
  return children;
}

/**
 * The one element the app puts in the dialog: the frame, then the body for the
 * state it was handed. `state: "ready"` promises that the view holds a lane with
 * `model.lane` in it, which is the caller's promise to make: a lane this view
 * cannot read throws rather than drawing half of one, and the app draws its
 * `failed` line instead.
 */
export function renderDrawer(model, nowMs, handlers) {
  return el("div", {
    attrs: { class: "drawer" },
    children: [drawerHeader(model, handlers), ...drawerBody(model, nowMs)],
  });
}
