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

  async function load() {
    if (route.kind === "unknown") {
      return { kind: "unknown" };
    }
    if (route.kind === "projects") {
      return { kind: "projects", projects: await loadProjects() };
    }
    // One call for the rail, one for the waves, both at once: the fleet needs
    // only the first, and a project route needs both before it can draw.
    const [projects, waves] = await Promise.all([
      loadProjects(),
      api.waves(route.id),
    ]);
    if (waves === undefined) {
      return { kind: "missing", project: route.id, projects };
    }
    if (!drawableWaves(waves)) {
      throw new Error("the wave list is not a list of waves");
    }
    const visible = visibleWaves(waves, showAll);
    const wanted = visible.find((head) => head.wave === selected);
    const chosen = wanted ?? visible[0];
    if (chosen === undefined) {
      return {
        kind: "project",
        project: route.id,
        projects,
        waves,
        view: undefined,
      };
    }
    selected = chosen.wave;
    const view = await api.wave(route.id, chosen.wave);
    if (selected !== chosen.wave) {
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
    return { kind: "project", project: route.id, projects, waves, view };
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
      return el("p", {
        attrs: { class: "empty" },
        text: note === "" ? LOADING : note,
      });
    }
    if (data.kind === "projects") {
      return renderFleet({ projects: data.projects }, clock());
    }
    if (data.kind === "project") {
      const project = data.project;
      const model = { ...data, showAll, selected, view: viewFor(data) };
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
      shell({ route, projects: data?.projects, note }, body()),
    );
  }

  /**
   * Loads, then draws, and never leaves a render failure half-applied: a `draw`
   * that throws on the data it was just handed puts the last data that did draw
   * back, says the page is offline, and draws that instead. A payload the views
   * cannot render therefore never reaches the document and never reaches
   * `onToggleAll`, which draws straight from the data kept here.
   *
   * Answers `false` when the load it did was for a wave the user has since
   * moved away from, so the caller can pass again for the current selection.
   */
  async function refresh() {
    const previous = data;
    try {
      const next = await load();
      if (next === undefined) {
        return false;
      }
      data = next;
      note = "";
      draw();
    } catch {
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

  /** Where the browser is now, and what the view asked for, read from it. */
  function read() {
    route = routeOf(location.pathname);
    query = parseQuery(location.search);
    showAll = query.all;
    selected = route.wave ?? "";
  }

  /** Forgets the data of the route being left, so nothing stale is drawn. */
  function reread() {
    read();
    data = undefined;
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
