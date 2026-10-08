import { el, internalLink, stamp, text } from "../dom.js";
import { reasonLabel } from "../attention.js";
import { formatQuery, TABS } from "../query.js";
import { matches, phaseOf, tabCounts, tabOf, totals } from "./fleet-model.js";
import { projectRow } from "./fleet-rows.js";
import { searchText } from "./project.js";

/**
 * The fleet page: what every project's recent waves are doing, beside what is
 * asking for attention. It is given a project list and an attention view that
 * have already passed their shape checks, and it returns a node for the shell to
 * put in its page area.
 *
 * Three readings of one answer, top to bottom: the hero's line of live counts,
 * the four stat cards that break it down, and the rows themselves — each project
 * in a native disclosure, its waves as a bar of segments, and the waves one by
 * one behind the chevron. The filter and the search live in the address rather
 * than inside a control a reload forgets, so every one of them is a place a
 * reader can be sent, read aloud, copied or opened in a new tab.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** The headline, in the face the plan's reference design opens with. */
const HEADLINE = "Every wave, accounted for.";

/** What this page is, said small above the headline. */
const EYEBROW = "fleet";

/** What a registry with nothing in it is called. */
const EMPTY_FLEET = "No projects registered yet.";

/** What a filter that leaves nothing behind is called. */
const NO_MATCH = "No project matches.";

/** Nothing is being asked for, in the panel's own words. */
const NOTHING_ATTENTION = "Nothing needs attention.";

/** The panel says so when the list of lanes was cut where it was. */
const TRUNCATED = "Showing the newest 200. More lanes matched.";

/** The placeholder in the fleet's search box. */
const SEARCH_PLACEHOLDER = "Filter projects";

/** The four tabs, in the order the nav offers them: every project, then three. */
const ALL_LABEL = "All";

/** The word each tab is shown as, as four literals rather than a capitalised id. */
const TAB_LABEL = { active: "Active", flagged: "Flagged", quiet: "Quiet" };

/**
 * The field along the hero's bottom edge: three waves, one below the other, in
 * module literals with nothing of the API in them. The drift is a CSS animation
 * on each path's own class, so no wave is ever moved from here.
 *
 * Each path carries the length of its own loop, which is the period its phase is
 * counted over (`phaseOf`). **Each of these three numbers must equal the
 * duration in the matching `.view.fleet .wave-a` rule in `fleet.css`**, which is
 * where the twelve phase delays for it are a twelfth of that number: change one
 * and change the other in the same commit, or the wave resumes where it was not.
 * All three are whole seconds, so each twelfth is a delay a stylesheet can write.
 */
const WAVE_A_MS = 19_000;
const WAVE_B_MS = 27_000;
const WAVE_C_MS = 37_000;

const WAVE_FIELD = [
  [
    "wave-a",
    WAVE_A_MS,
    "M-72 20c12-8 24-8 36 0s24 8 36 0 24-8 36 0 24 8 36 0 24-8 36 0 24 8 36 0 24-8 36 0 24 8 36 0",
  ],
  [
    "wave-b",
    WAVE_B_MS,
    "M-72 26c12-8 24-8 36 0s24 8 36 0 24-8 36 0 24 8 36 0 24-8 36 0 24 8 36 0 24-8 36 0 24 8 36 0",
  ],
  [
    "wave-c",
    WAVE_C_MS,
    "M-72 32c12-8 24-8 36 0s24 8 36 0 24-8 36 0 24 8 36 0 24-8 36 0 24 8 36 0 24-8 36 0 24 8 36 0",
  ],
];

/**
 * One count and the noun it counts, singular for one and plural for every other
 * number — including zero, which is a count of none and reads as one. Every
 * phrase this page builds around a count goes through here, so "1 needs" is
 * never written beside "0 need" anywhere on it.
 */
function counted(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * The live counts in one line, over the whole fleet and before any filter: the
 * stat cards below break the same three numbers down.
 */
function heroCounts(counts) {
  const projects = counted(counts.projects, "project", "projects");
  const running = `${counted(counts.running, "wave", "waves")} running`;
  const asking = `${counted(counts.asking, "lane asking", "lanes asking")} for attention`;
  return `${projects} · ${running} · ${asking}`;
}

/** The field itself: three paths, and nothing of the answer in either. */
function waveField(nowMs) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "wave-field");
  svg.setAttribute("viewBox", "0 0 120 36");
  // Stretched rather than letterboxed: the field is a full-bleed ground, and a
  // wave scaled to fit a wide, short box would sit in the middle of it instead.
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const [className, periodMs, d] of WAVE_FIELD) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("class", `${className} ${phaseOf(nowMs, periodMs)}`);
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

/**
 * The hero: what this page is, its one line of live counts, and the field below
 * it. Compact on purpose (W38) — a console that is polled every ten seconds
 * cannot afford a hero that pushes the fleet below the fold — and the field is
 * in the flow under the counts rather than drawn over them, so no width of the
 * window can put a wave through a line of text.
 */
function hero(counts, nowMs) {
  return el("header", {
    attrs: { class: "fleet-hero" },
    children: [
      el("p", { attrs: { class: "eyebrow" }, text: EYEBROW }),
      el("h1", { text: HEADLINE }),
      el("p", { attrs: { class: "hero-counts" }, text: heroCounts(counts) }),
      waveField(nowMs),
    ],
  });
}

/**
 * One card's mark: an inline SVG of its own, from two constants, as `logo.js`
 * does it. Nothing here is computed — no name from the API, no value from the
 * address — so there is nothing for a stored payload to travel on.
 */
function mark(paths) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "stat-icon");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

/** The four cards' marks, one per card, each in the state colour it counts. */
const PROJECTS_MARK = ["M2 5.5 8 2.5l6 3-6 3-6-3Z", "M2 10.5 8 13.5l6-3"];
const WAVES_MARK = ["M1 9c1.7-2.7 3.3-2.7 5 0s3.3 2.7 5 0 3.3-2.7 5 0"];
const LANES_MARK = ["M3 13.5V7.5M8 13.5V3.5M13 13.5V9.5"];
const ATTENTION_MARK = ["M8 2 14 13.5H2Z", "M8 6.5v3.2M8 11.6h.01"];

/**
 * One stat card: its own mark, the term, the number, and a caption that says
 * what the number is a part of. The number never counts up: `draw()` replaces
 * every node on the page every ten seconds, so a JavaScript count-up would be
 * restarted on every pass and would never finish (W34).
 */
function stat(icon, term, value, caption, warn) {
  return el("div", {
    attrs: { class: warn === true ? "stat warn" : "stat" },
    children: [
      icon,
      el("dt", { text: term }),
      el("dd", { text: String(value) }),
      el("p", { attrs: { class: "stat-caption" }, text: caption }),
    ],
  });
}

/**
 * The four numbers the cards break the hero's line down into.
 *
 * Every caption says its number in words as well as showing it, and a warning
 * says so in the caption rather than only in a colour: a card that is only amber
 * is a card a reader who cannot see amber has not read (W14).
 */
function stats(counts) {
  return el("dl", {
    attrs: { class: "stats" },
    children: [
      stat(
        mark(PROJECTS_MARK),
        "Projects",
        counts.projects,
        counts.stale === 0 ? "none stale" : `${counts.stale} stale`,
        false,
      ),
      stat(
        mark(WAVES_MARK),
        "Waves running",
        counts.running,
        `of ${counts.recent} recent`,
        false,
      ),
      stat(
        mark(LANES_MARK),
        "Lanes",
        counts.lanes,
        `${counts.merged} merged in recent waves`,
        false,
      ),
      stat(
        mark(ATTENTION_MARK),
        "Need attention",
        counts.asking,
        counts.asking === 0 ? "none" : "asking now",
        counts.asking > 0,
      ),
    ],
  });
}

/** The filter and the search, as one row above the rows they narrow. */
function filters(model, handlers) {
  return el("div", {
    attrs: { class: "fleet-filters" },
    children: [tabs(model), search(model, handlers)],
  });
}

/**
 * The four tabs, each with the count of what it is about to show and each a link
 * rather than a button: a filter is a place a reader can be sent, and a button
 * is not one. The counts are over the whole fleet, so a tab cannot be hidden by
 * the search sitting beside it, and the search is carried into every one of them
 * so that choosing a tab does not throw the reader's own words away.
 */
function tabs(model) {
  const counts = tabCounts(model.projects, model.attention);
  const children = [];
  for (const [tab, label] of [
    [undefined, ALL_LABEL],
    ...TABS.map((name) => [name, TAB_LABEL[name]]),
  ]) {
    children.push(
      internalLink(
        label,
        `/${formatQuery({ tab, q: model.query.q, all: false })}`,
        model.query.tab === tab ? { "aria-current": "page" } : {},
      ),
    );
    children.push(
      el("span", {
        attrs: { class: "count" },
        text: String(counts[tab ?? "all"]),
      }),
    );
  }
  return el("nav", {
    attrs: { class: "fleet-tabs", "aria-label": "Project filter" },
    children,
  });
}

/**
 * The search box. It carries `data-key="q"`, so `/` finds it and a redraw puts
 * the caret back where it was, exactly as on a project's page: it is the same
 * control, the same key and the same query, and it hands the address the same
 * cleaned text through `searchText`.
 *
 * A character still being composed is not asked for: asking redraws the page, and
 * replacing the box under an input method ends the composition.
 */
function search(model, handlers) {
  const input = el("input", {
    attrs: {
      type: "search",
      name: "q",
      id: "fleet-q",
      "data-key": "q",
      placeholder: SEARCH_PLACEHOLDER,
      value: model.query.q ?? "",
    },
  });
  input.addEventListener("input", (event) => {
    if (event.isComposing === true) {
      return;
    }
    handlers.onSearch(searchText(input.value));
  });
  input.addEventListener("compositionend", () => {
    handlers.onSearch(searchText(input.value));
  });
  return el("div", {
    attrs: { class: "fleet-search" },
    children: [
      el("label", { attrs: { for: "fleet-q" }, text: "Search" }),
      input,
    ],
  });
}

/**
 * The projects, in the order the API gave them, narrowed by the address.
 *
 * An empty registry and an empty filter are two different answers and say two
 * different things: "no projects registered yet" is about the service, while
 * "no project matches" is about the reader's own choice, and a fleet that was
 * filtered away must not read as a service that has lost its projects.
 */
function projectsPanel(model, nowMs, handlers) {
  const children = [el("h2", { text: "Projects" }), filters(model, handlers)];
  const shown = model.projects.filter(
    (project) =>
      (model.query.tab === undefined ||
        tabOf(project, model.attention) === model.query.tab) &&
      matches(project, model.query.q),
  );
  if (shown.length === 0) {
    children.push(
      el("p", {
        attrs: { class: "empty" },
        text: model.projects.length === 0 ? EMPTY_FLEET : NO_MATCH,
      }),
    );
  } else {
    for (const project of shown) {
      children.push(projectRow(project, model, nowMs));
    }
  }
  return el("section", {
    attrs: { class: "fleet-projects" },
    children,
  });
}

/** The lane's own page, with the lane chosen: nothing else this panel knows. */
function attentionHref(entry) {
  return `/p/${encodeURIComponent(entry.project)}/w/${encodeURIComponent(entry.wave)}${formatQuery({ lane: entry.lane, all: false })}`;
}

/**
 * One lane that is asking for attention, as a row: the link, where it is, why,
 * and the numbers a reader would otherwise have to go and look up. Everything
 * optional is absent when the API did not send it, rather than shown empty.
 */
function attentionItem(entry, nowMs) {
  const children = [
    internalLink(entry.lane, attentionHref(entry)),
    el("span", {
      attrs: { class: "where" },
      children: [
        el("code", { text: entry.project }),
        text(" / "),
        el("code", { text: entry.wave }),
      ],
    }),
  ];
  for (const reason of entry.reasons) {
    children.push(
      el("span", {
        attrs: { class: "badge reason" },
        text: reasonLabel(reason),
      }),
    );
  }
  if (entry.stale) {
    children.push(
      el("span", { attrs: { class: "badge stale" }, text: "stale" }),
    );
  }
  if (entry.seat !== undefined) {
    children.push(el("span", { attrs: { class: "seat" }, text: entry.seat }));
  }
  if (entry.pr !== undefined) {
    children.push(
      el("span", { attrs: { class: "pr" }, text: `PR #${entry.pr}` }),
    );
  }
  children.push(stamp(entry.receivedAt, nowMs));
  return el("li", { children });
}

/** The panel, and the line that says the list was cut when it was. */
function attentionPanel(attention, nowMs) {
  const children = [el("h2", { text: "Needs attention" })];
  if (attention.lanes.length === 0) {
    children.push(
      el("p", { attrs: { class: "empty" }, text: NOTHING_ATTENTION }),
    );
  } else {
    children.push(
      el("ul", {
        attrs: { class: "attention" },
        children: attention.lanes.map((entry) => attentionItem(entry, nowMs)),
      }),
    );
  }
  if (attention.truncated) {
    children.push(
      el("p", { attrs: { class: "note-inline" }, text: TRUNCATED }),
    );
  }
  return el("section", {
    attrs: { class: "fleet-attention" },
    children,
  });
}

/**
 * The whole page, in the order it is read: the hero, the cards that break its
 * counts down, and then the two columns — the projects, which are wide, and the
 * panel, which is not.
 */
export function renderFleet(model, nowMs, handlers) {
  // Counted once, so that the hero's line and the cards under it are two
  // readings of one answer rather than two passes that could disagree.
  const counts = totals(model.projects, model.attention);
  return el("section", {
    attrs: { class: "view fleet" },
    children: [
      hero(counts, nowMs),
      stats(counts),
      el("div", {
        attrs: { class: "fleet-grid" },
        children: [
          projectsPanel(model, nowMs, handlers),
          attentionPanel(model.attention, nowMs),
        ],
      }),
    ],
  });
}
