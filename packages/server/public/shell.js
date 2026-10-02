import { el, internalLink, text } from "./dom.js";
import { waveCountText } from "./format.js";
import { isProjectId } from "./patterns.js";

/**
 * The frame around whatever a view drew: a rail of projects, a top bar holding
 * the breadcrumb and the note, and the page itself. Every node here is built by
 * `dom.js`, and every project field has already passed the shape check, so a
 * name a pusher chose reaches the document as text and as nothing else.
 */

const BRAND = "waves";
const LOADING = "Loading…";
const NO_PROJECTS = "No projects registered yet.";

/** The three words the tables below use, said once, where a reader can find them. */
const LEGEND = [
  "stale — no snapshot inside the wave's interval; liveness reads unknown",
  "disagreement — reported and derived differ",
  "agrees — reported matches derived",
];

/** Where the reader already is: never a link, and said so to assistive tech. */
function here(label) {
  return el("span", {
    attrs: { class: "here", "aria-current": "page" },
    text: label,
  });
}

/** An id, in the typeface an id is read in. */
function hereId(label) {
  return el("span", {
    attrs: { class: "here", "aria-current": "page" },
    children: [el("code", { text: label })],
  });
}

/**
 * The trail to the page being shown: every part but the last is a link back up
 * it, the last is here. An id came out of a path the server served, so it is the
 * page's own text; only an id that is a whole route becomes a link.
 */
function breadcrumb(route) {
  if (route.kind !== "project") {
    return [here(BRAND)];
  }
  const parts = [internalLink(BRAND, "/")];
  parts.push(
    route.wave === undefined
      ? hereId(route.id)
      : internalLink(route.id, `/p/${route.id}`),
  );
  if (route.wave !== undefined) {
    parts.push(hereId(route.wave));
  }
  const children = [];
  parts.forEach((part, at) => {
    if (at > 0) {
      children.push(text(" / "));
    }
    children.push(part);
  });
  return children;
}

/**
 * One project in the rail: its name as the link to its page, and its wave count
 * beneath. An id that is not one the app owns is not linked to at all, because
 * the rail is where every registered project is listed and a path there that
 * leads nowhere is a dead end the reader can see and not follow.
 */
function projectItem(project, current) {
  const anchor = internalLink(project.name, `/p/${project.id}`);
  if (current) {
    anchor.setAttribute("aria-current", "page");
  }
  const meta = [waveCountText(project.waves)];
  if (project.stale) {
    meta.push("stale");
  }
  return el("li", {
    children: [anchor, el("small", { text: meta.join(" · ") })],
  });
}

function projectList(projects, route) {
  if (projects === undefined) {
    return [el("p", { text: LOADING })];
  }
  const kept = projects.filter((project) => isProjectId(project.id));
  if (kept.length === 0) {
    return [el("p", { text: NO_PROJECTS })];
  }
  const on = route.kind === "project" ? route.id : "";
  return [
    el("ul", {
      attrs: { class: "projects" },
      children: kept.map((project) => projectItem(project, project.id === on)),
    }),
  ];
}

function rail(model) {
  return el("aside", {
    attrs: { class: "rail" },
    children: [
      el("div", {
        attrs: { class: "brand" },
        children: [
          internalLink(BRAND, "/"),
          el("small", { text: "read-only" }),
        ],
      }),
      el("nav", {
        attrs: { class: "rail-nav", "aria-label": "Projects" },
        children: [
          el("h2", { text: "Projects" }),
          ...projectList(model.projects, model.route),
        ],
      }),
      el("div", {
        attrs: { class: "legend" },
        children: LEGEND.map((line) => el("p", { text: line })),
      }),
    ],
  });
}

/**
 * The note, once. It lives here rather than at the head of the page so that
 * every page has one place to look for it, and it is a live region so a screen
 * reader hears a failed load as well as seeing it.
 */
function status(note) {
  if (note === "") {
    return el("span", {
      attrs: { class: "status", role: "status", "aria-live": "polite" },
    });
  }
  return el("span", {
    attrs: { class: "note", role: "status", "aria-live": "polite" },
    text: note,
  });
}

export function shell(model, body) {
  return el("div", {
    attrs: { class: "app" },
    children: [
      rail(model),
      el("header", {
        attrs: { class: "topbar" },
        children: [
          el("nav", {
            attrs: { class: "crumbs", "aria-label": "Breadcrumb" },
            children: breadcrumb(model.route),
          }),
          status(model.note),
        ],
      }),
      el("main", { attrs: { class: "page" }, children: [body] }),
    ],
  });
}
