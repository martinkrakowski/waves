import { el, internalLink, text } from "./dom.js";
import { clockTime, waveCountText } from "./format.js";
import { logo } from "./logo.js";
import { isProjectId } from "./patterns.js";

/**
 * The frame around whatever a view drew: a top bar holding the mark, the
 * breadcrumb, the projects menu and the two controls that speak to the app, the
 * page itself, and a footer bar for what the page has to say out loud. Every node
 * here is built by `dom.js` — the mark by `logo.js`, the refresh arrow the same
 * way, from constants — and every project field has already passed the shape
 * check, so a name a pusher chose reaches the document as text and as nothing
 * else.
 */

const BRAND = "waves";
/** The tag beside the word, saying which of the pages this is. */
const CONSOLE = "console";
const LOADING = "Loading…";
const NO_PROJECTS = "No projects registered yet.";
/** The pill before anything has loaded: a time would be a claim, and this is not one. */
const SYNCING = "syncing…";

/**
 * The words the tables below use, said once, where a reader can find them: the
 * three terms the lane tables have always used, and the four states a wave is
 * summarised in. Each carries a square of the colour it is shown in elsewhere on
 * the page. `stale` is one chip and not two — it is both a flag and a state, and
 * a legend that said it twice would be longer for saying nothing extra.
 */
const LEGEND = [
  {
    swatch: "stale",
    text: "stale — no snapshot inside the wave's interval; liveness reads unknown",
  },
  {
    swatch: "disagreement",
    text: "disagreement — reported and derived differ",
  },
  { swatch: "agrees", text: "agrees — reported matches derived" },
  { swatch: "running", text: "running" },
  { swatch: "done", text: "done" },
  { swatch: "settled", text: "settled" },
  { swatch: "failed", text: "failed" },
];

/** The refresh arrow, as the two paths of one circle: the arc, then its head. */
const ARROW = ["M19.9 12a7.9 7.9 0 1 1-2.3-5.6", "M20 3v5h-5"];

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
  if (route.kind === "projects") {
    return [here(BRAND)];
  }
  // A page that is not one of ours still has the fleet above it, and with the
  // rail gone this is the only link that leads there.
  if (route.kind !== "project") {
    return [internalLink(BRAND, "/")];
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
 * `open` is set through the element's property, on the element `el()`
 * returned, because `dom.js`'s attribute table has no entry for it: the table
 * is the way in for a value that varies, and this one is the app's own boolean.
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

/**
 * One word of the legend: a square of its colour, and the word itself. The square
 * carries no text, so it says nothing to a screen reader and the colour is never
 * the only thing carrying the meaning — the word beside it is, which is why every
 * term here is written out rather than being a swatch and a hope.
 */
function legendChip(entry) {
  return el("p", {
    attrs: { class: "legend-chip" },
    children: [
      el("span", { attrs: { class: `swatch ${entry.swatch}` } }),
      el("span", { text: entry.text }),
    ],
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
        children: LEGEND.map(legendChip),
      }),
    ],
  });
}

/**
 * When this page last loaded, and whether it is talking to the service now.
 *
 * The time is the app's own clock at the moment a pass answered, not the moment
 * this frame was drawn, so the ten-second redraw does not move it. Before the
 * first load there is no time to show and the pill says so rather than naming the
 * hour the page happened to be opened in.
 *
 * The dot pings only while there is no note. A dot still pulsing over "offline,
 * retrying" claims a liveness the page has not got, so the offline pill carries
 * the class the stylesheet reads to stop it and to say amber instead.
 */
function syncPill(model) {
  const offline = model.note !== "";
  return el("span", {
    attrs: { class: offline ? "sync offline" : "sync" },
    children: [
      el("span", { attrs: { class: "sync-dot" } }),
      el("span", {
        attrs: { class: "sync-label" },
        text:
          model.syncedAt === undefined
            ? SYNCING
            : `synced ${clockTime(model.syncedAt)}`,
      }),
    ],
  });
}

/**
 * The refresh arrow, in the SVG namespace with literal attribute names and
 * literal path data, for the reason `logo.js` gives: the page's CSP has no
 * `img-src`, so an icon has to be built in the document. Nothing here is computed,
 * so there is nothing for a stored payload to travel on.
 */
function refreshArrow() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "arrow");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const d of ARROW) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

/**
 * The reader's own pass, which is the one thing the ten-second timer cannot do.
 *
 * `data-key="refresh"` is what keeps the focus here across a redraw:
 * `focusedLink()` remembers a control by the key it was drawn with, and this one
 * has neither an address nor a caret to remember it by. The click is handled here
 * rather than by the shell's navigation handler, which only follows links.
 *
 * The spin is drawn from `model.syncing`, which the app sets when it starts a pass
 * and clears when that pass has drawn, so the arrow turns for a load the reader
 * asked for and stays still for the timer's.
 */
function refreshButton(model, handlers) {
  const button = el("button", {
    attrs: {
      class: model.syncing ? "refresh spin" : "refresh",
      type: "button",
      "aria-label": "Refresh now",
      "data-key": "refresh",
    },
    children: [refreshArrow()],
  });
  button.addEventListener("click", () => {
    handlers.onRefresh();
  });
  return button;
}

export function shell(model, body, handlers) {
  return el("div", {
    attrs: { class: "app" },
    children: [
      el("header", {
        attrs: { class: "topbar" },
        children: [
          logo(),
          el("nav", {
            attrs: { class: "crumbs", "aria-label": "Breadcrumb" },
            children: breadcrumb(model.route, model.all),
          }),
          el("span", { attrs: { class: "tag" }, text: CONSOLE }),
          syncPill(model),
          refreshButton(model, handlers),
          menu(model),
        ],
      }),
      el("main", { attrs: { class: "page" }, children: [body] }),
      footbar(model),
    ],
  });
}
