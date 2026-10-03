import { el, internalLink, repoLink, stamp, text } from "../dom.js";
import { laneCountText } from "../format.js";
import { isProjectId } from "../patterns.js";
import { attentionOf, phaseOf, ringOf, tabOf } from "./fleet-model.js";
import { pathFor } from "./project.js";

/**
 * One project's row: what the project is, what its recent waves are doing, and
 * — when the row is opened — the waves themselves with a link each.
 *
 * Everything a row shows comes from `recentWaves`, the summary's own newest
 * waves (W36), and from the attention view, both of which have passed their
 * shape checks before this view is asked for anything. Every link below is built
 * from an id held to `patterns.js`: a project whose id fails `isProjectId` and a
 * wave id that fails `isWaveId` have no path on this service, and a link to a
 * path the server never serves is a dead end a reader can see.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * What a row's key is prefixed with. The app reads the project id back off a
 * `summary`'s key on every `toggle` it hears, so a row's key is the whole of
 * "which rows are open" that survives a redraw.
 */
const ROW_PREFIX = "row:";

/** What a project that registered no repository is said to have. */
const NO_REPO = "no repository registered";

/** The line a project that has retained no wave gets in place of a bar. */
const NO_RECENT_WAVES = "no recent waves";

/** What a project that has pushed nothing has for a last push. */
const NEVER = "never";

/** What a status that carried no backlog at all is said to report. */
const NOTHING_REPORTED = "nothing reported";

/**
 * A wave's state as the class of its segment in the bar, and the same four
 * states as the class of the word on its chip: four literals each, because an
 * API string in a class name is a class name this page did not write.
 */
const SEGMENT = {
  failed: "seg failed",
  done: "seg done",
  running: "seg running",
  settled: "seg settled",
};

const CHIP = {
  failed: "state failed",
  done: "state done",
  running: "state running",
  settled: "state settled",
};

/**
 * The ring's own radius in the 24-unit square it is drawn in, and the length of
 * the whole circle at it. The `cx`, `cy` and `r` below are the same three
 * numbers, written out: they never change, and an attribute this page does not
 * vary has no reason to be held in a variable.
 */
const RING_RADIUS = 9;
const RING_AROUND = 2 * Math.PI * RING_RADIUS;

/**
 * The length of the running segment's sheen loop, which is the period its phase
 * is counted over (`phaseOf`). **This number must equal the duration in the
 * `.view.fleet .seg.running` rule in `fleet.css`**, which is where the twelve
 * phase delays for it are a twelfth of that number. It is a whole number of
 * seconds, so each twelfth is a delay a stylesheet can write.
 */
const SHEEN_MS = 4_000;

/**
 * The project id a row's key names, or nothing: a `details` whose summary
 * carries no `row:` key is not a row of this page, however it is classed. The
 * app asks this of every toggle it hears, because `toggle` fires for every
 * `details` on the page and only the class tells them apart.
 */
export function rowIdOf(node) {
  const key = node.querySelector("summary")?.getAttribute("data-key") ?? "";
  return key.startsWith(ROW_PREFIX) ? key.slice(ROW_PREFIX.length) : undefined;
}

/** One wave in the bar: a colour, and the whole of what it says in a word. */
function segment(wave, nowMs) {
  const classes = [SEGMENT[wave.state]];
  if (wave.stale === true) {
    classes.push("stale");
  }
  // A running segment is the only segment that moves, so it is the only one that
  // carries a phase, and it carries the sheen's own (see `phaseOf`): the sheen
  // would otherwise restart at 0% on every pass and every navigation.
  if (wave.state === "running") {
    classes.push(phaseOf(nowMs, SHEEN_MS));
  }
  return el("li", {
    attrs: { class: classes.join(" ") },
    children: [
      el("span", {
        attrs: { class: "sr" },
        text: `${wave.wave}: ${wave.state}${wave.stale === true ? ", stale" : ""}`,
      }),
    ],
  });
}

/**
 * The bar: one segment per recent wave, oldest on the left and newest on the
 * right, so the eye reads it in time. It is a list and not an image, because
 * each segment says its own state in text for a reader who cannot see the
 * colour, and a `role="img"` would swallow exactly that.
 */
function waveBar(project, nowMs) {
  if (project.recentWaves.length === 0) {
    return [
      el("p", {
        attrs: { class: "bar-empty" },
        text: NO_RECENT_WAVES,
      }),
    ];
  }
  return [
    el("ul", {
      attrs: {
        class: "wave-bar",
        "aria-label": "Recent waves, oldest first",
      },
      // The listing answers newest first; a bar is read left to right.
      children: [...project.recentWaves]
        .reverse()
        .map((wave) => segment(wave, nowMs)),
    }),
  ];
}

/** What a project that pushed no `plan:verify` artifact last said: nothing. */
function statusFact(status, nowMs) {
  const parts = [
    text(
      status.backlogState === undefined
        ? NOTHING_REPORTED
        : `backlog ${status.backlogState}`,
    ),
  ];
  if (status.prsSkipped !== undefined && status.prsSkipped > 0) {
    parts.push(text(` · ${status.prsSkipped} PR rows unread`));
  }
  parts.push(text(" · "), stamp(status.receivedAt, nowMs));
  return el("span", { children: parts });
}

/**
 * What the row's caption says: how much of the work the waves the reader can see
 * is done, which wave arrived last and what it said, and when the project itself
 * last pushed. A project with no retained wave has no "newest" to name, so the
 * caption says the one fact it does have rather than naming nothing.
 */
function caption(project, nowMs) {
  const waves = project.recentWaves;
  const lead =
    waves.length === 0
      ? NO_RECENT_WAVES
      : `${waves.filter((wave) => wave.state === "done").length}/${waves.length} waves done · newest ${waves[0].wave} ${waves[0].state}`;
  return el("p", {
    attrs: { class: "row-caption" },
    children: [
      text(`${lead} · last push `),
      project.lastPush === undefined
        ? text(NEVER)
        : stamp(project.lastPush, nowMs),
    ],
  });
}

/**
 * The share of the project's recent waves' lanes that are merged, drawn as a
 * ring and said beside it as a percentage: the number is the fact, and the
 * circle is only a second way of seeing it. No ring at all when those waves hold
 * no lane between them — a circle of nothing is a gauge of nothing — and none
 * either when the share cannot be computed into a dash.
 */
function ring(project) {
  const { lanes, merged } = ringOf(project);
  // The shape check holds every wave to `merged <= lanes`, so a share above one
  // is a server that answered a different question. Capping it draws a full ring
  // rather than a dash longer than the circle it is drawn on, which a
  // `stroke-dasharray` silently repeats as a second arc.
  const share = Math.min(1, merged / lanes);
  const dash = RING_AROUND * share;
  // Both numbers of the dash are this page's own arithmetic over counts it did
  // not derive, and an SVG attribute is the last place a `NaN` should still be
  // able to reach the document.
  if (![dash, RING_AROUND].every((value) => Number.isFinite(value))) {
    return [];
  }
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "ring");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const value = circle("value");
  value.setAttribute(
    "stroke-dasharray",
    `${dash.toFixed(2)} ${RING_AROUND.toFixed(2)}`,
  );
  // From twelve o'clock, so a share that has just begun starts at the top.
  value.setAttribute("transform", "rotate(-90 12 12)");
  svg.append(circle("track"), value);
  return [
    svg,
    el("span", {
      attrs: { class: "ring-label" },
      text: `${Math.round(share * 100)}% merged`,
    }),
  ];
}

/** One of the ring's two circles: the same geometry, and one name or two. */
function circle(className) {
  const node = document.createElementNS(SVG_NS, "circle");
  node.setAttribute("class", className);
  node.setAttribute("cx", "12");
  node.setAttribute("cy", "12");
  node.setAttribute("r", "9");
  return node;
}

/**
 * How many lanes are asking for this project, said as one row flag and as one
 * word of grammar: "1 needs attention" and "2 need attention". Zero draws no flag
 * at all, which is the answer the dot's own tab already carries.
 */
function attentionFlag(asking) {
  return el("span", {
    attrs: { class: "flag" },
    text: asking === 1 ? "1 needs attention" : `${asking} need attention`,
  });
}

/**
 * Everything the row's closed line shows: which tab it is in, what is asking for
 * it, whether it has stopped pushing, its waves, how far along they are, how
 * many lanes it has and how much of that work is merged.
 *
 * The name and the `repo · id` line are **not** in here: a `summary` is a
 * button, and a link inside a button is interactive content inside a control
 * (W39). They sit above it in `rowHead`, outside the row's own disclosure.
 */
function summaryBody(project, model, nowMs) {
  const tab = tabOf(project, model.attention);
  const asking = attentionOf(model.attention, project.id);
  const children = [
    el("span", {
      attrs: { class: `dot ${tab}` },
      children: [el("span", { attrs: { class: "sr" }, text: tab })],
    }),
  ];
  if (asking > 0) {
    children.push(attentionFlag(asking));
  }
  if (project.stale === true) {
    children.push(
      el("span", { attrs: { class: "pill stale" }, text: "stale" }),
    );
  }
  children.push(
    ...waveBar(project, nowMs),
    caption(project, nowMs),
    el("span", {
      attrs: { class: "lane-count" },
      text: laneCountText(project.lanes),
    }),
    ...ring(project),
    el("span", { attrs: { class: "chevron" } }),
  );
  return children;
}

/**
 * The project, above its row: its name as a link to its own page when the id is
 * one the app owns, and as plain text when it is not, so a project whose id is a
 * pusher's own string is still readable and simply has nowhere to lead to.
 */
function rowHead(project) {
  return el("div", {
    attrs: { class: "row-head" },
    children: [
      el("h3", {
        children: [
          isProjectId(project.id)
            ? internalLink(project.name, pathFor(project.id, undefined))
            : text(project.name),
        ],
      }),
      el("p", {
        attrs: { class: "row-id" },
        children: [
          repoLink(project.repo ?? NO_REPO, project.repo),
          text(" · "),
          el("code", { text: project.id }),
        ],
      }),
    ],
  });
}

/** One wave, in the opened row: a link to it, its state, its two counts. */
function chip(project, wave, nowMs) {
  const children = [
    internalLink(wave.wave, pathFor(project.id, wave.wave)),
    el("span", { attrs: { class: CHIP[wave.state] }, text: wave.state }),
    text(`${laneCountText(wave.lanes)} · ${wave.merged} merged`),
  ];
  if (wave.stale === true) {
    children.push(
      el("span", { attrs: { class: "badge stale" }, text: "stale" }),
    );
  }
  children.push(stamp(wave.receivedAt, nowMs));
  return el("li", { children });
}

/**
 * The opened row's waves, newest first: the one that arrived last is the one a
 * reader opening a project is looking for.
 */
function waveChips(project, nowMs) {
  if (project.recentWaves.length === 0) {
    return [];
  }
  return [
    el("ul", {
      attrs: { class: "wave-chips" },
      children: project.recentWaves.map((wave) => chip(project, wave, nowMs)),
    }),
  ];
}

/**
 * What the project last said about itself, under the waves and in the words the
 * old card used: the state of its last `plan:verify` artifact, how many
 * pull-request rows its last listing could not read, and when the document
 * arrived.
 *
 * No stale badge here, and the reason is the document's own bound: the contract
 * caps a status's staleness window at 300 s, and a project that pushes a status
 * once per run would therefore read stale nearly every time a reader looked. The
 * receive time says the same thing without a badge that is almost always on —
 * and the API still answers `stale`, so a client that wants the rule has it.
 *
 * Absent for a project that has pushed no status: a row that said "nothing to
 * report" for a document that was never sent would be a claim about silence.
 */
function statusRow(project, nowMs) {
  if (project.status === undefined) {
    return [];
  }
  return [
    el("dl", {
      attrs: { class: "row-facts" },
      children: [
        el("dt", { text: "status" }),
        el("dd", { children: [statusFact(project.status, nowMs)] }),
      ],
    }),
  ];
}

/**
 * One project's row, and the only place on the page that puts a project's waves
 * in a disclosure.
 *
 * A project whose id is one the app owns gets a `details`, and its `open` is set
 * through the property rather than an attribute — `dom.js`'s table has no entry
 * for `open`, because the table is the way in for a value that varies and this
 * one is the app's own answer to "which rows did the reader open".
 *
 * A project whose id is **not** one the app owns has no page, no key and nothing
 * to open, so it keeps every number the row shows and draws them as a static
 * summary instead of a control: a project a reader can read and cannot click.
 */
export function projectRow(project, model, nowMs) {
  const head = rowHead(project);
  const body = summaryBody(project, model, nowMs);
  if (!isProjectId(project.id)) {
    return el("article", {
      attrs: { class: "project" },
      children: [
        head,
        el("div", { attrs: { class: "row-summary" }, children: body }),
      ],
    });
  }
  const details = el("details", {
    attrs: { class: "project-row" },
    children: [
      el("summary", {
        attrs: { "data-key": `${ROW_PREFIX}${project.id}` },
        children: body,
      }),
      el("div", {
        attrs: { class: "row-body" },
        children: [...waveChips(project, nowMs), ...statusRow(project, nowMs)],
      }),
    ],
  });
  details.open = model.open.has(project.id);
  return el("article", {
    attrs: { class: "project" },
    children: [head, details],
  });
}
