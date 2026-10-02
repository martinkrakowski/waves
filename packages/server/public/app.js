import { drawableAttention } from "./attention.js";
import { createApi } from "./api.js";
import { el } from "./dom.js";
import { drawableProjectLanes } from "./project-lanes.js";
import { drawableProjects } from "./projects.js";
import { isProjectId, isWaveId } from "./patterns.js";
import { parseQuery } from "./query.js";
import { shell } from "./shell.js";
import { renderFleet } from "./views/fleet.js";
import { renderProject } from "./views/project.js";

export const REFRESH_MS = 10_000;

const ROOT_ID = "root";
const PROJECT_PREFIX = "/p/";
const WAVE_SEGMENT = "/w/";
const OFFLINE_NOTE = "offline, retrying";
const LOADING = "Loading…";

/** `/p/<id>` or `/p/<id>/w/<wave>`: the server serves the page on both. */
const PROJECT_PATH = /^\/p\/([^/]+)(\/w\/([^/]+))?$/;

export function routeOf(pathname) {
  if (pathname === "/" || pathname === "") {
    return { kind: "projects" };
  }
  if (!pathname.startsWith(PROJECT_PREFIX)) {
    return { kind: "unknown" };
  }
  const parts = PROJECT_PATH.exec(pathname);
  if (parts === null) {
    return { kind: "unknown" };
  }
  const id = parts[1];
  // The segments are read as they arrived: a valid id never needs decoding, so
  // a segment carrying a percent escape is a segment the server never served.
  if (!isProjectId(id)) {
    return { kind: "unknown" };
  }
  if (parts[2] === undefined) {
    return { kind: "project", id };
  }
  const wave = parts[3];
  return isWaveId(wave) ? { kind: "project", id, wave } : { kind: "unknown" };
}

/**
 * The path a route is drawn at. A valid id needs no encoding, so the
 * `encodeURIComponent` only matters to a hand-built route, and the fleet is the
 * path for anything that is not a project.
 */
export function pathOf(route) {
  if (route.kind !== "project") {
    return "/";
  }
  const project = `${PROJECT_PREFIX}${encodeURIComponent(route.id)}`;
  return route.wave === undefined
    ? project
    : `${project}${WAVE_SEGMENT}${encodeURIComponent(route.wave)}`;
}

/** Only same-origin absolute paths: no scheme, and no protocol-relative form. */
function ownPath(url) {
  if (!url.startsWith("/") || url.startsWith("//") || url.startsWith("/\\")) {
    return undefined;
  }
  return url;
}

export function createApp(deps) {
  const {
    doc,
    location,
    history,
    win,
    fetch: fetchImpl,
    setTimer,
    clearTimer,
    clock,
    refreshMs = REFRESH_MS,
  } = deps;
  const api = createApi(fetchImpl);
  const root = doc.getElementById(ROOT_ID);
  let route = routeOf(location.pathname);
  let query = parseQuery(location.search);
  let data = undefined;
  let note = "";
  let generation = 0;
  /**
   * The last project list the API gave us and the rail could show. It has its
   * own place because the rail is on every route: a navigation is not a reason
   * to stop knowing which projects exist, and a failed load is not a reason to
   * forget them. Only a successful load moves it.
   */
  let railProjects;
  /**
   * The last attention view the API gave us, held exactly as the project list
   * is: the rail counts from it on every route, so a navigation is not a reason
   * to stop knowing what is being asked for, and a failed load is not a reason
   * to forget it.
   */
  let railAttention;
  let timer = undefined;
  let inFlight = undefined;
  let stopped = false;

  /**
   * The project list, which the rail draws on every route and the fleet page
   * draws as its body. A response the rail cannot show is a failed load, not an
   * empty registry.
   */
  async function loadProjects() {
    const projects = await api.projects();
    if (!drawableProjects(projects)) {
      throw new Error("the project list is not a list of projects");
    }
    return projects;
  }

  /**
   * What every project's lanes are asking for, which the rail counts and the
   * fleet page lists. A 404 is a failed load, not an empty answer: the route is
   * not optional, and a page whose counters silently became zero would be
   * claiming nothing is wrong.
   */
  async function loadAttention() {
    const attention = await api.attention();
    if (attention === undefined) {
      throw new Error("the attention view is not there");
    }
    if (!drawableAttention(attention)) {
      throw new Error("the attention view is not an attention view");
    }
    return attention;
  }

  /**
   * One pass, for the route and the query this call started with. The snapshot
   * is taken before the first `await` and is the only thing read after it:
   * `read()` rewrites `route` and `query` on every navigation, so a pass that
   * read them afterwards would answer one page with another's request.
   *
   * After each `await`, a pass that the reader has navigated away from answers
   * `undefined`, which is how `refreshOnce()` learns to pass again for the route
   * that is on screen now.
   */
  async function load() {
    const at = route;
    const asked = query;
    const mine = generation;
    if (at.kind === "unknown") {
      // Not a page of ours, but the rail is: the reader still has to be able to
      // get to a project from here, and the rail's two lists are the whole of
      // what the route has to know.
      const [projects, attention] = await Promise.all([
        loadProjects(),
        loadAttention(),
      ]);
      if (mine !== generation) {
        return undefined;
      }
      return { kind: "unknown", projects, attention };
    }
    if (at.kind === "projects") {
      const [projects, attention] = await Promise.all([
        loadProjects(),
        loadAttention(),
      ]);
      if (mine !== generation) {
        return undefined;
      }
      return { kind: "projects", projects, attention };
    }
    // Three calls in one Promise.all, in the order the page needs them: the
    // rail's two, then every lane of every wave of the project the route names.
    // A project page is one request: the wave strip and the lane table are two
    // views of the same answer, and a second request would be a second chance
    // for the two to disagree.
    const [projects, attention, lanes] = await Promise.all([
      loadProjects(),
      loadAttention(),
      api.lanes(at.id, asked.all),
    ]);
    if (mine !== generation) {
      return undefined;
    }
    if (lanes === undefined) {
      return { kind: "missing", project: at.id, projects, attention };
    }
    if (!drawableProjectLanes(lanes)) {
      throw new Error("the project listing is not a project listing");
    }
    if (lanes.project.id !== at.id) {
      throw new Error("the project listing is another project's");
    }
    return { kind: "project", project: at.id, projects, attention, lanes };
  }

  function body() {
    if (route.kind === "unknown") {
      // A path that is not a page is not one whatever the load says, so it is
      // said at once and stays said while the rail's data loads or fails.
      return el("p", { attrs: { class: "empty" }, text: "No such page." });
    }
    if (data === undefined) {
      // Only the shell's status region carries the note: saying it here as well
      // would put "offline, retrying" on the page twice, once before there is
      // anything to load and once where every page has one place to look.
      return el("p", { attrs: { class: "empty" }, text: LOADING });
    }
    if (data.kind === "projects") {
      return renderFleet(
        { projects: data.projects, attention: data.attention },
        clock(),
      );
    }
    if (data.kind === "project") {
      // No handlers: every control this view draws is a link, and the app
      // follows its own links in place.
      return renderProject(
        { lanes: data.lanes, wave: route.wave, query },
        clock(),
      );
    }
    return el("p", { attrs: { class: "empty" }, text: "No such project." });
  }

  /**
   * The link the reader's focus is on — its address, and which of the links
   * with that address it is — so a redraw can put them back on the same one.
   * Several links share an address (the rail and a card both lead to a project),
   * and landing on the first of them would pull a reader out of the list they
   * were working down. `draw()` replaces every node, which on the ten-second
   * refresh would otherwise take the focus with it and drop a keyboard reader
   * at the top of the page. Compared by value, never by selector: an `href` is
   * an API string and does not belong in a query.
   */
  function focusedLink() {
    const active = doc.activeElement;
    if (active === null || !root.contains(active)) {
      return undefined;
    }
    const href = active.getAttribute("href");
    if (href === null) {
      return undefined;
    }
    const anchors = [...root.querySelectorAll("a")];
    const nth = anchors
      .slice(0, Math.max(anchors.indexOf(active), 0))
      .filter((anchor) => anchor.getAttribute("href") === href).length;
    return { href, nth };
  }

  /**
   * Puts the focus on the link of the new document that stands where the old
   * one stood among the links with its address, without scrolling to it: a
   * reader who scrolled away is not dragged back every ten seconds.
   */
  function refocus(link) {
    if (link === undefined) {
      return;
    }
    const same = [...root.querySelectorAll("a")].filter(
      (anchor) => anchor.getAttribute("href") === link.href,
    );
    same[link.nth]?.focus({ preventScroll: true });
  }

  function draw() {
    doc.title = route.kind === "project" ? `waves — ${route.id}` : "waves";
    if (root === null) {
      return;
    }
    const focused = focusedLink();
    root.replaceChildren(
      shell(
        {
          route,
          projects: railProjects,
          attention: railAttention,
          all: query.all,
          note,
        },
        body(),
      ),
    );
    refocus(focused);
  }

  /**
   * Loads, then draws, and never leaves a render failure half-applied: a `draw`
   * that throws on the data it was just handed puts the last data that did draw
   * back, says the page is offline, and draws that instead. A payload the views
   * cannot render therefore never reaches the document.
   *
   * Answers `false` when the load it did was for a route the reader has since
   * moved away from, so the caller can pass again for the one on screen. A pass
   * that failed after losing its route says nothing: its failure is about a page
   * nobody is on, and putting that page's data back would draw the route being
   * left under the route being read.
   */
  async function refresh() {
    const mine = generation;
    const previous = data;
    try {
      const next = await load();
      if (next === undefined) {
        return false;
      }
      data = next;
      // Every pass that answered carries both of the rail's lists, on every
      // route, so this is where they move and nowhere else: a navigation keeps
      // them and a failed load never reaches this line, so neither can clear
      // what the reader can already see.
      railProjects = next.projects;
      railAttention = next.attention;
      note = "";
      draw();
    } catch {
      if (mine !== generation) {
        return false;
      }
      data = previous;
      note = OFFLINE_NOTE;
      draw();
    }
    return true;
  }

  /**
   * One refresh pass at a time. A caller that arrives while one is in flight
   * waits for that one rather than starting a second, which is what keeps the
   * timer callback, a visibility change and a click from chaining loops. A pass
   * that loses its wave to a click passes again, so the wave the user chose last
   * is the wave that ends up on screen, and the pass it superseded is dropped
   * rather than drawn.
   */
  async function refreshOnce() {
    if (inFlight !== undefined) {
      return inFlight;
    }
    inFlight = (async () => {
      let drawn = await refresh();
      while (drawn === false) {
        drawn = await refresh();
      }
      return drawn;
    })();
    try {
      return await inFlight;
    } finally {
      inFlight = undefined;
    }
  }

  function schedule() {
    if (stopped || doc.hidden) {
      return;
    }
    if (timer !== undefined) {
      clearTimer(timer);
      timer = undefined;
    }
    timer = setTimer(() => {
      timer = undefined;
      void refreshOnce().then(schedule, schedule);
    }, refreshMs);
  }

  /**
   * Where the browser is now, and what the view asked for, read from it. Every
   * read starts a new generation, so a pass already in flight knows at once that
   * it is answering a page the reader has left.
   */
  function read() {
    route = routeOf(location.pathname);
    query = parseQuery(location.search);
    generation += 1;
  }

  /** Whether a route is another wave of the project already on screen. */
  function sameProject(was, now) {
    return (
      was.kind === "project" && now.kind === "project" && was.id === now.id
    );
  }

  /**
   * Forgets what belonged to the route being left, so nothing stale is drawn,
   * and the note with it: a note about the page the reader has just left is not
   * a note about this one.
   *
   * Another wave of the project already on screen is the same project, so its
   * lanes stay where they are while the pass for the new wave runs: the table a
   * reader is working down does not vanish under them because they followed a
   * link. The rail's list is never cleared at all: it is the same for every
   * route, and blanking it to "Loading…" on each click, and for ever on a route
   * that fetches nothing, was a page that had lost the one thing it knew.
   */
  function reread() {
    const was = route;
    read();
    note = "";
    if (!sameProject(was, route)) {
      data = undefined;
    }
    draw();
    void refreshOnce().then(schedule, schedule);
  }

  function navigate(url) {
    const path = ownPath(url);
    if (path === undefined) {
      return;
    }
    if (path === `${location.pathname}${location.search}`) {
      return;
    }
    history.pushState(null, "", path);
    reread();
  }

  function onPopState() {
    reread();
  }

  /**
   * A plain primary click on one of the app's own links is this page's
   * navigation; every other click is the browser's. A modified click still
   * opens a tab, and a repository link still leaves the page.
   */
  function onClick(event) {
    if (event.defaultPrevented || event.button !== 0) {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const node = event.target;
    if (node === null || node.nodeType !== 1) {
      return;
    }
    const anchor = node.closest("a");
    if (anchor === null || anchor.getAttribute("data-key") !== "nav") {
      return;
    }
    const href = anchor.getAttribute("href");
    event.preventDefault();
    if (href !== null) {
      navigate(href);
    }
  }

  function onVisibility() {
    if (doc.hidden) {
      if (timer !== undefined) {
        clearTimer(timer);
        timer = undefined;
      }
      return;
    }
    void refreshOnce().then(schedule, schedule);
  }

  function start() {
    stopped = false;
    read();
    doc.addEventListener("visibilitychange", onVisibility);
    win.addEventListener("popstate", onPopState);
    if (root !== null) {
      root.addEventListener("click", onClick);
    }
    draw();
    void refreshOnce().then(schedule, schedule);
  }

  function stop() {
    stopped = true;
    if (timer !== undefined) {
      clearTimer(timer);
      timer = undefined;
    }
    doc.removeEventListener("visibilitychange", onVisibility);
    win.removeEventListener("popstate", onPopState);
    if (root !== null) {
      root.removeEventListener("click", onClick);
    }
  }

  return {
    start,
    stop,
    refresh,
    navigate,
    get route() {
      return route;
    },
  };
}

export function boot(globals) {
  const app = createApp(globals);
  app.start();
  return app;
}
