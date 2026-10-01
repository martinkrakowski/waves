import { el, internalLink, stamp, text } from "./dom.js";
import { laneCountText, waveCountText } from "./format.js";
import { laneTable } from "./lanes.js";

const PAST_RETENTION = "past retention";

export function visibleWaves(waves, showAll) {
  return showAll ? waves : waves.filter((head) => head.retained);
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
          text(` · ${laneCountText(view.envelope.lanes.length)}`),
          text(" "),
          stamp(view.receivedAt, nowMs),
        ],
      }),
    ],
  });
}

function lanePanel(model, nowMs) {
  const view = model.view;
  if (view === undefined) {
    return el("p", {
      attrs: { class: "empty" },
      text:
        model.waves.length === 0
          ? "This project has no waves yet."
          : "That wave is no longer stored.",
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
  const retained = model.waves.filter((head) => head.retained).length;
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
          ...retentionToggle(model, retained, handlers.onToggleAll),
        ],
      }),
      lanePanel(model, nowMs),
    ],
  });
}
