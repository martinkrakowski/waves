import { el, stamp, text } from "./dom.js";
import {
  aliveView,
  detailValue,
  diffText,
  gateText,
  pullRequestText,
  reportedText,
} from "./format.js";

const COLUMNS = ["lane", "reported", "alive", "pr", "gate", "diff", "notes"];

function cell(label, children) {
  return el("td", { attrs: { "data-label": label }, children });
}

function badge(label, className) {
  return el("span", { attrs: { class: `badge ${className}` }, text: label });
}

function pair(key, value) {
  return el("li", {
    children: [el("code", { text: key }), text(": "), text(value)],
  });
}

function laneCell(lane) {
  const parts = [el("code", { text: lane.id })];
  if (lane.seat !== undefined) {
    parts.push(
      el("small", { attrs: { class: "meta" }, text: `seat ${lane.seat}` }),
    );
  }
  return cell("lane", parts);
}

function detailList(detail) {
  if (detail === undefined) {
    return [];
  }
  const keys = Object.keys(detail);
  if (keys.length === 0) {
    return [];
  }
  return [
    el("ul", {
      attrs: { class: "detail" },
      children: keys.map((key) => pair(key, detailValue(detail[key]))),
    }),
  ];
}

function reportedCell(lane, nowMs) {
  const parts = [text(reportedText(lane.reported))];
  if (lane.reported !== undefined) {
    parts.push(stamp(lane.reported.ts, nowMs));
    parts.push(...detailList(lane.reported.detail));
  }
  return cell("reported", parts);
}

function proseList(lane) {
  const items = [];
  if (lane.derived.planReview !== undefined) {
    items.push(pair("plan review", lane.derived.planReview));
  }
  if (lane.derived.risk !== undefined) {
    items.push(pair("risk", lane.derived.risk));
  }
  if (items.length === 0) {
    return [];
  }
  return [el("ul", { attrs: { class: "prose" }, children: items })];
}

function disagreementList(lane) {
  if (lane.disagreements.length === 0) {
    return [el("span", { attrs: { class: "muted" }, text: "none" })];
  }
  return [
    el("ul", {
      attrs: { class: "disagreements" },
      children: lane.disagreements.map((line) => el("li", { text: line })),
    }),
  ];
}

function logBlock(log, generatedAt) {
  const tail = log?.tail;
  if (tail === undefined) {
    return el("span", { attrs: { class: "muted" }, text: "no tail pushed" });
  }
  return el("details", {
    children: [
      el("summary", { text: `last 4 KiB as of ${generatedAt}` }),
      el("pre", { attrs: { class: "tail" }, text: tail }),
    ],
  });
}

function notesCell(lane, generatedAt) {
  return cell("notes", [
    ...disagreementList(lane),
    ...proseList(lane),
    logBlock(lane.derived.log, generatedAt),
  ]);
}

function laneRow(lane, nowMs, generatedAt) {
  const alive = aliveView(lane.derived.alive);
  return el("tr", {
    children: [
      laneCell(lane),
      reportedCell(lane, nowMs),
      cell("alive", [badge(alive.label, alive.className)]),
      cell("pr", [text(pullRequestText(lane.derived.pr))]),
      cell("gate", [text(gateText(lane.derived.gate))]),
      cell("diff", [text(diffText(lane.derived.diff))]),
      notesCell(lane, generatedAt),
    ],
  });
}

/** The lanes a view can show: the ones the API could actually describe. */
export function drawableLanes(view) {
  return (view.envelope.lanes ?? []).filter(
    (lane) => lane !== null && lane !== undefined,
  );
}

export function laneTable(view, nowMs) {
  return el("table", {
    attrs: { class: "lanes" },
    children: [
      el("thead", {
        children: [
          el("tr", {
            children: COLUMNS.map((label) => el("th", { text: label })),
          }),
        ],
      }),
      el("tbody", {
        children: drawableLanes(view).map((lane) =>
          laneRow(lane, nowMs, view.envelope.generatedAt),
        ),
      }),
    ],
  });
}
