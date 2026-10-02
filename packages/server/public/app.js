import { createApi } from "./api.js";
import { el } from "./dom.js";
import { drawableProjects } from "./projects.js";
import { isProjectId, isWaveId } from "./patterns.js";
import { formatQuery, parseQuery } from "./query.js";
import { shell } from "./shell.js";
import { renderFleet } from "./views/fleet.js";
import { renderProject } from "./views/project.js";
import { drawableWave, drawableWaves, visibleWaves } from "./wave.js";

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
  let showAll = query.all;
  let data = undefined;
  let note = "";
  let selected = route.wave ?? "";
  let generation = 0;
  /**
   * The last project list the API gave us and the rail could show. It has its
   * own place because the rail is on every route: a navigation is not a reason
   * to stop knowing which projects exist, and a failed load is not a reason to
   * forget them. Only a successful load moves it.
   */
  let railProjects;
  /**
   * Whether the data on screen was kept across a move to another wave of the
   * same project and the pass for that wave has not answered yet. Until it does,
   * the lane panel has nothing to show for the selection and must say it is
   * loading, not that the wave is gone.
   */
  let awaitingWave = false;
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
   * One pass, for the route and the selection this call started with. The
   * snapshot is taken before the first `await` and is the only thing read after
   * it: `read()` rewrites `route` and `selected` on every navigation, so a pass
   * that read them afterwards would answer one page with another's request.
   *
   * After each `await`, a pass that the reader has navigated away from answers
   * `undefined`, which is how `refreshOnce()` learns to pass again for the route
   * that is on screen now.
   */
  async function load() {
    const at = route;
    const want = selected;
    const mine = generation;
    if (at.kind === "unknown") {
      return { kind: "unknown" };
    }
    if (at.kind === "projects") {
      const projects = await loadProjects();
      if (mine !== generation) {
        return undefined;
      }
      return { kind: "projects", projects };
    }
    // One call for the rail, one for the waves, both at once: the fleet needs
    // only the first, and a project route needs both before it can draw.
    const [projects, waves] = await Promise.all([
      loadProjects(),
      api.waves(at.id),
    ]);
    if (mine !== generation) {
      return undefined;
    }
    if (waves === undefined) {
      return { kind: "missing", project: at.id, projects };
    }
    if (!drawableWaves(waves)) {
      throw new Error("the wave list is not a list of waves");
    }
    const visible = visibleWaves(waves, showAll);
    const wanted = visible.find((head) => head.wave === want);
    const chosen = wanted ?? visible[0];
    if (chosen === undefined) {
      return {
        kind: "project",
        project: at.id,
        projects,
        waves,
        view: undefined,
      };
    }
    selected = chosen.wave;
    const view = await api.wave(at.id, chosen.wave);
    if (mine !== generation || selected !== chosen.wave) {
      return undefined;
    }
    if (view !== undefined) {
      if (!drawableWave(view)) {
        throw new Error("the wave is not a wave");
      }
      if (view.envelope.wave !== chosen.wave) {
        throw new Error("the wave is not the one requested");
      }
    }
    return { kind: "project", project: at.id, projects, waves, view };
  }

  /** The lanes on screen, and only ever the lanes of the selected wave. */
  function viewFor(model) {
    const view = model.view;
    if (view === undefined || view.envelope.wave !== selected) {
      return undefined;
    }
    return view;
  }

  function body() {
    if (data === undefined) {
      // Only the shell's status region carries the note: saying it here as well
      // would put "offline, retrying" on the page twice, once before there is
      // anything to load and once where every page has one place to look.
      return el("p", { attrs: { class: "empty" }, text: LOADING });
    }
    if (data.kind === "projects") {
      return renderFleet({ projects: data.projects }, clock());
    }
    if (data.kind === "project") {
      const project = data.project;
      const model = {
        ...data,
        showAll,
        selected,
        view: viewFor(data),
        loading: awaitingWave,
      };
      return renderProject(model, clock(), {
        onSelect: (waveId) => {
          navigate(
            pathOf({ kind: "project", id: project, wave: waveId }) +
              formatQuery({ ...query, all: showAll }),
          );
        },
        onToggleAll: () => {
          showAll = !showAll;
          const visible = visibleWaves(model.waves, showAll);
          if (!visible.some((head) => head.wave === selected)) {
            selected = "";
          }
          draw();
        },
      });
    }
    if (data.kind === "missing") {
      return el("p", {
        attrs: { class: "empty" },
        text: "No such project.",
      });
    }
    return el("p", { attrs: { class: "empty" }, text: "No such page." });
  }

  function draw() {
    doc.title = route.kind === "project" ? `waves — ${route.id}` : "waves";
    if (root === null) {
      return;
    }
    root.replaceChildren(
      shell({ route, projects: railProjects, note }, body()),
    );
  }

  /**
   * Loads, then draws, and never leaves a render failure half-applied: a `draw`
   * that throws on the data it was just handed puts the last data that did draw
   * back, says the page is offline, and draws that instead. A payload the views
   * cannot render therefore never reaches the document and never reaches
   * `onToggleAll`, which draws straight from the data kept here.
   *
   * Answers `false` when the load it did was for a route or a wave the reader has
   * since moved away from, so the caller can pass again for the one on screen. A
   * pass that failed after losing its route says nothing: its failure is about a
   * page nobody is on, and putting that page's data back would draw the route
   * being left under the route being read.
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
      awaitingWave = false;
      if (next.projects !== undefined) {
        railProjects = next.projects;
      }
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
    showAll = query.all;
    selected = route.wave ?? "";
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
   * Choosing another wave of the project already on screen changes nothing but
   * the wave, so that project's wave list stays where it is while the new wave's
   * lanes load. The rail's list is never cleared at all: it is the same for
   * every route, and blanking it to "Loading…" on each click, and for ever on a
   * route that fetches nothing, was a page that had lost the one thing it knew.
   */
  function reread() {
    const was = route;
    read();
    note = "";
    awaitingWave = sameProject(was, route) && data !== undefined;
    if (!awaitingWave) {
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
