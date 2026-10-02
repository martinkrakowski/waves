import { el, internalLink, stamp, text } from "./dom.js";
import { laneCountText, waveCountText } from "./format.js";
import { drawableLanes, laneTable } from "./lanes.js";

const PAST_RETENTION = "past retention";

/** The required fields of one wave head, as the wave list endpoint sends it. */
function waveHead(head) {
  return (
    head !== null &&
    typeof head === "object" &&
    typeof head.wave === "string" &&
    typeof head.receivedAt === "string" &&
    typeof head.lanes === "number" &&
    typeof head.stale === "boolean" &&
    typeof head.retained === "boolean"
  );
}

/**
 * Whether a response is a list this view can show at all. A list holding an
 * entry it cannot show is a broken endpoint, and the app treats it as a failed
 * load rather than replacing a wave list that was right with a shorter one.
 */
export function drawableWaves(waves) {
  return Array.isArray(waves) && waves.every(waveHead);
}

/** The waves the list can show: the ones the API could actually describe. */
function presentWaves(waves) {
  return waves.filter((head) => head !== null && head !== undefined);
}

export function visibleWaves(waves, showAll) {
  const kept = presentWaves(waves);
  return showAll ? kept : kept.filter((head) => head.retained);
}

function badge(label, className) {
  return el("span", { attrs: { class: `badge ${className}` }, text: label });
}

function waveItem(head, current, nowMs, onSelect) {
  const meta = [
    laneCountText(head.lanes),
    head.intervalSeconds === null
      ? "no interval"
      : `every ${head.intervalSeconds}s`,
  ];
  const children = [
    el("code", { text: head.wave }),
    el("span", { attrs: { class: "meta" }, text: meta.join(" · ") }),
    stamp(head.receivedAt, nowMs),
  ];
  if (head.stale) {
    children.push(badge("stale", "stale"));
  }
  if (!head.retained) {
    children.push(badge(PAST_RETENTION, "aging"));
  }
  const button = el("button", {
    attrs: { class: current ? "wave current" : "wave", type: "button" },
    children,
  });
  button.addEventListener("click", () => onSelect(head.wave));
  return el("li", { attrs: { class: "wave-item" }, children: [button] });
}

function retentionToggle(model, retained, onToggleAll) {
  if (model.waves.length === retained) {
    return [];
  }
  const toggle = el("button", {
    attrs: { class: "toggle", type: "button" },
    text: model.showAll
      ? "show only retained"
      : `show ${waveCountText(model.waves.length - retained)} ${PAST_RETENTION}`,
  });
  toggle.addEventListener("click", onToggleAll);
  return [toggle];
}

function waveList(model, nowMs, onSelect) {
  const visible = visibleWaves(model.waves, model.showAll);
  if (visible.length === 0) {
    return el("p", {
      attrs: { class: "empty" },
      text:
        model.waves.length === 0
          ? "No waves pushed yet."
          : `Every wave is ${PAST_RETENTION}.`,
    });
  }
  return el("ul", {
    attrs: { class: "wave-list" },
    children: visible.map((head) =>
      waveItem(head, head.wave === model.selected, nowMs, onSelect),
    ),
  });
}

function waveHeading(view, nowMs) {
  return el("h2", {
    children: [
      text("wave "),
      el("code", { text: view.envelope.wave }),
      el("span", {
        attrs: { class: "meta" },
        children: [
          text(` · ${laneCountText(drawableLanes(view).length)}`),
          text(" "),
          stamp(view.receivedAt, nowMs),
        ],
      }),
    ],
  });
}

/** Why there are no lanes: nothing pushed, nothing chosen, or nothing stored. */
function lanePanelMessage(model) {
  if (model.waves.length === 0) {
    return "This project has no waves yet.";
  }
  const visible = visibleWaves(model.waves, model.showAll);
  if (model.selected === "" && visible.length > 0) {
    return "No wave selected.";
  }
  return "That wave is no longer stored.";
}

function lanePanel(model, nowMs) {
  const view = model.view;
  if (view === undefined) {
    return el("p", {
      attrs: { class: "empty" },
      text: lanePanelMessage(model),
    });
  }
  const children = [waveHeading(view, nowMs)];
  if (view.stale) {
    children.push(
      el("p", {
        attrs: { class: "banner stale" },
        text: "This wave is stale: no snapshot arrived inside its interval, so lane liveness reads unknown.",
      }),
    );
  }
  children.push(laneTable(view, nowMs));
  return el("div", { attrs: { class: "lane-panel" }, children });
}

export function wavePanel(model, nowMs, handlers) {
  const kept = presentWaves(model.waves);
  const retained = kept.filter((head) => head.retained).length;
  return el("section", {
    attrs: { class: "view" },
    children: [
      el("h1", {
        children: [
          internalLink("waves", "/"),
          text(" / "),
          el("code", { text: model.project }),
        ],
      }),
      el("div", {
        attrs: { class: "waves" },
        children: [
          el("h2", { text: "Waves" }),
          waveList(model, nowMs, handlers.onSelect),
          ...retentionToggle(
            { ...model, waves: kept },
            retained,
            handlers.onToggleAll,
          ),
        ],
      }),
      lanePanel(model, nowMs),
    ],
  });
}
