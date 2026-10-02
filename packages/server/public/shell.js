import { el, internalLink, text } from "./dom.js";
import { waveCountText } from "./format.js";
import { isProjectId } from "./patterns.js";

/**
 * The frame around whatever a view drew: a top bar holding the breadcrumb and
 * the projects menu, the page itself, and a footer bar for what the page has to
 * say out loud. Every node here is built by `dom.js`, and every project field
 * has already passed the shape check, so a name a pusher chose reaches the
 * document as text and as nothing else.
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
 * A project's own page, carrying the show-all state the reader has chosen when
 * they leave the page they are on. A link that dropped it would show a project
 * with fewer waves than the reader asked to see, for no reason they could see.
 * The links back to the fleet are bare, because the fleet is not filtered.
 */
function projectHref(id, all) {
  return all ? `/p/${id}?all=1` : `/p/${id}`;
}

/**
 * The trail to the page being shown: every part but the last is a link back up
 * it, the last is here. An id came out of a path the server served, so it is the
 * page's own text; only an id that is a whole route becomes a link.
 */
function breadcrumb(route, all) {
  if (route.kind !== "project") {
    return [here(BRAND)];
  }
  const parts = [internalLink(BRAND, "/")];
  parts.push(
    route.wave === undefined
      ? hereId(route.id)
      : internalLink(route.id, projectHref(route.id, all)),
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
 * How many of a project's lanes are asking for attention, or nothing: the
 * count comes from the same view the fleet page lists, and a project it says
 * nothing about, or a project asking for nothing, is not annotated at all.
 */
function attentionSuffix(attention, id) {
  if (attention === undefined) {
    return "";
  }
  const found = attention.projects.find((entry) => entry.id === id);
  if (found === undefined || found.attention === 0) {
    return "";
  }
  return found.attention === 1
    ? " · 1 needs attention"
    : ` · ${found.attention} need attention`;
}

/**
 * One project in the menu: its name as the link to its page, and its wave count
 * beneath, with what is asking for attention beside that. An id that is not one
 * the app owns is not linked to at all, because the menu is where every
 * registered project is listed and a path there that leads nowhere is a dead end
 * the reader can see and not follow.
 */
function projectItem(project, current, attention, all) {
  const anchor = internalLink(
    project.name,
    projectHref(project.id, all),
    current ? { "aria-current": "page" } : {},
  );
  const meta = [
    waveCountText(project.waves) + attentionSuffix(attention, project.id),
  ];
  if (project.stale) {
    meta.push("stale");
  }
  return el("li", {
    children: [anchor, el("small", { text: meta.join(" · ") })],
  });
}

/** The projects the app owns a path for, in the order the API gave them. */
function keptProjects(projects) {
  return projects.filter((project) => isProjectId(project.id));
}

function projectList(projects, route, attention, all) {
  if (projects === undefined) {
    return [el("p", { text: LOADING })];
  }
  const kept = keptProjects(projects);
  if (kept.length === 0) {
    return [el("p", { text: NO_PROJECTS })];
  }
  const on = route.kind === "project" ? route.id : "";
  return [
    el("ul", {
      attrs: { class: "projects" },
      children: kept.map((project) =>
        projectItem(project, project.id === on, attention, all),
      ),
    }),
  ];
}

/** What the summary says: the word alone until the first answer, then a count. */
function menuLabel(projects) {
  if (projects === undefined) {
    return "Projects";
  }
  return `Projects (${keptProjects(projects).length})`;
}

/**
 * The projects, in the top bar: a native `details`, so Enter and Space open it
 * with no script at all, and the summary counts what is actually in the list.
 *
 * `open` is a property and not an attribute, so it is set here on the element
 * `el()` returned rather than through `dom.js`'s table — that table is the way
 * in for a name, and this shell never varies one.
 */
function menu(model) {
  const details = el("details", {
    attrs: { class: "menu" },
    children: [
      el("summary", {
        attrs: { "data-key": "menu" },
        text: menuLabel(model.projects),
      }),
      el("nav", {
        attrs: { class: "menu-list", "aria-label": "Projects" },
        children: projectList(
          model.projects,
          model.route,
          model.attention,
          model.all,
        ),
      }),
    ],
  });
  details.open = model.menuOpen;
  return details;
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

/** The bar below the page: the note, the mode this build runs in, and the words. */
function footbar(model) {
  return el("footer", {
    attrs: { class: "footbar" },
    children: [
      status(model.note),
      el("small", { attrs: { class: "mode" }, text: "read-only" }),
      el("div", {
        attrs: { class: "legend" },
        children: LEGEND.map((line) => el("p", { text: line })),
      }),
    ],
  });
}

export function shell(model, body) {
  return el("div", {
    attrs: { class: "app" },
    children: [
      el("header", {
        attrs: { class: "topbar" },
        children: [
          el("nav", {
            attrs: { class: "crumbs", "aria-label": "Breadcrumb" },
            children: breadcrumb(model.route, model.all),
          }),
          menu(model),
        ],
      }),
      el("main", { attrs: { class: "page" }, children: [body] }),
      footbar(model),
    ],
  });
}
