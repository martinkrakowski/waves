import { el, internalLink, repoLink, stamp, text } from "../dom.js";
import { waveCountText } from "../format.js";
import { isProjectId } from "../patterns.js";
import { formatQuery } from "../query.js";

/**
 * The fleet page: what every project's lanes reported, beside what the last push
 * could derive. It is given projects and an attention view that have already
 * passed their shape checks, and it returns a node for the shell to put in its
 * page area.
 *
 * Every class name below is one of this file's own literals, and every link is
 * built from three ids the page holds to the patterns in `patterns.js`: a link
 * to a path the server never serves is a dead end the reader can see.
 */

const NO_REPO = "no repository registered";
const EMPTY_FLEET = "No projects registered yet.";
const NOTHING_ATTENTION = "Nothing needs attention.";
const TRUNCATED = "Showing the newest 200. More lanes matched.";
const LEDE =
  "What each project's lanes reported, beside what the last push could derive. The gap is flagged, not resolved.";

/** What one project is asking for, or nothing: the view has no entry for it. */
function attentionOf(attention, projectId) {
  const found = attention.projects.find((entry) => entry.id === projectId);
  return found === undefined ? 0 : found.attention;
}

/** One number, with the name it counts, in a box of its own. */
function kpi(label, value, warn) {
  return el("div", {
    attrs: { class: warn === true ? "kpi warn" : "kpi" },
    children: [el("dt", { text: label }), el("dd", { text: String(value) })],
  });
}

function sum(counts) {
  return counts.reduce((total, count) => total + count, 0);
}

/**
 * The five numbers the page leads with. Two of them are warnings, and both say
 * so in colour and in the number itself: a counter that is only amber is a
 * counter a reader who cannot see amber has not read.
 */
function counters(model) {
  const projects = model.projects;
  const attention = model.attention;
  const asking = sum(attention.projects.map((entry) => entry.attention));
  const stale = projects.filter((project) => project.stale === true).length;
  return el("dl", {
    attrs: { class: "kpis" },
    children: [
      kpi("Projects", projects.length, false),
      kpi("Waves", sum(projects.map((project) => project.waves)), false),
      kpi("Lanes", sum(projects.map((project) => project.lanes)), false),
      kpi("Need attention", asking, asking > 0),
      kpi("Stale projects", stale, stale > 0),
    ],
  });
}

/**
 * The card's heading: the project's name as a link to its page when the id is
 * one the app owns, and as plain text when it is not, so a card whose name is a
 * pusher's string is still readable and simply has nowhere to link to. The
 * freshness pill is always there, in a word rather than in a colour.
 */
function heading(project) {
  const name = isProjectId(project.id)
    ? internalLink(project.name, `/p/${project.id}`)
    : text(project.name);
  return el("h3", {
    children: [
      name,
      el("span", {
        attrs: { class: project.stale === true ? "pill stale" : "pill fresh" },
        text: project.stale === true ? "stale" : "fresh",
      }),
    ],
  });
}

/** A term and its value: the two are direct children of the `dl`. */
function fact(term, value) {
  return [el("dt", { text: term }), el("dd", { children: [value] })];
}

/** What a card says about a project that has reported no backlog at all. */
const NOTHING_REPORTED = "nothing reported";

/**
 * What the project last said about itself, as one fact: the state of its last
 * `plan:verify` artifact, how many pull-request rows its last listing could not
 * read, and when the whole document arrived.
 *
 * No stale badge here, and the reason is the document's own bound: the contract
 * caps a status's staleness window at 300 s, and a project that pushes a status
 * once per run would therefore read stale nearly every time a reader looked. The
 * receive time says the same thing without a badge that is almost always on — and
 * the API still answers `stale`, so a client that wants the rule has it.
 */
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
 * What the page knows about one project. The wave and lane counts come from the
 * same summary the rail draws, and the attention count from the attention view,
 * so the card and the rail can never disagree about how much is asking.
 */
function facts(project, attention, nowMs) {
  const pushed =
    project.lastPush === undefined
      ? text("never")
      : stamp(project.lastPush, nowMs);
  const rows = [
    ...fact("id", el("code", { text: project.id })),
    ...fact("repo", repoLink(project.repo ?? NO_REPO, project.repo)),
    ...fact("waves", text(waveCountText(project.waves))),
    ...fact("lanes", text(project.lanes)),
    ...fact("last push", pushed),
    ...fact("attention", text(attentionOf(attention, project.id))),
  ];
  // Absent for a project that has pushed no status: a row that said "nothing to
  // report" for a document that was never sent would be a claim about silence.
  if (project.status !== undefined) {
    rows.push(...fact("status", statusFact(project.status, nowMs)));
  }
  return el("dl", { attrs: { class: "facts" }, children: rows });
}

function projectCard(project, attention, nowMs) {
  return el("article", {
    attrs: { class: "project-card" },
    children: [heading(project), facts(project, attention, nowMs)],
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
      el("span", { attrs: { class: "badge reason" }, text: reason }),
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

function projectsPanel(model, nowMs) {
  const children = [el("h2", { text: "Projects" })];
  if (model.projects.length === 0) {
    children.push(el("p", { attrs: { class: "empty" }, text: EMPTY_FLEET }));
  } else {
    for (const project of model.projects) {
      children.push(projectCard(project, model.attention, nowMs));
    }
  }
  return el("section", {
    attrs: { class: "fleet-projects" },
    children,
  });
}

export function renderFleet(model, nowMs) {
  return el("section", {
    attrs: { class: "view fleet" },
    children: [
      el("h1", { text: "Fleet" }),
      el("p", { attrs: { class: "lede" }, text: LEDE }),
      counters(model),
      el("div", {
        attrs: { class: "fleet-grid" },
        children: [
          projectsPanel(model, nowMs),
          attentionPanel(model.attention, nowMs),
        ],
      }),
    ],
  });
}
