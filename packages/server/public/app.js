import { createApi } from "./api.js";
import { el } from "./dom.js";
import { drawableProjects, projectList } from "./projects.js";
import {
  drawableWave,
  drawableWaves,
  visibleWaves,
  wavePanel,
} from "./wave.js";

export const REFRESH_MS = 10_000;

const ROOT_ID = "root";
const PROJECT_PREFIX = "/p/";
/** `/p/<id>/w/<wave>`: the server serves the page there, so the page must know it. */
const WAVE_PATH = /^\/p\/([^/]+)\/w\/[^/]+$/;
const OFFLINE_NOTE = "offline, retrying";
const LOADING = "Loading…";

function decodeId(pathname) {
  try {
    return decodeURIComponent(pathname.slice(PROJECT_PREFIX.length));
  } catch {
    return undefined;
  }
}

export function routeOf(pathname) {
  if (pathname === "/" || pathname === "") {
    return { kind: "projects" };
  }
  if (pathname.startsWith(PROJECT_PREFIX)) {
    // A wave path is its project's page for now: the wave it names is not yet a
    // selection, but it must never be read as part of the project's id.
    const wavePath = WAVE_PATH.exec(pathname);
    const id = decodeId(
      wavePath === null ? pathname : `${PROJECT_PREFIX}${wavePath[1]}`,
    );
    return id === undefined || id === ""
      ? { kind: "unknown" }
      : { kind: "project", id };
  }
  return { kind: "unknown" };
}

export function createApp(deps) {
  const {
    doc,
    location,
    fetch: fetchImpl,
    setTimer,
    clearTimer,
    clock,
    refreshMs = REFRESH_MS,
  } = deps;
  const api = createApi(fetchImpl);
  const route = routeOf(location.pathname);
  const root = doc.getElementById(ROOT_ID);
  let data = undefined;
  let note = "";
  let showAll = false;
  let selected = "";
  let timer = undefined;
  let inFlight = undefined;
  let stopped = false;

  async function load() {
    if (route.kind === "projects") {
      const projects = await api.projects();
      if (!drawableProjects(projects)) {
        throw new Error("the project list is not a list of projects");
      }
      return { kind: "projects", projects };
    }
    if (route.kind === "project") {
      const waves = await api.waves(route.id);
      if (waves === undefined) {
        return { kind: "missing" };
      }
      if (!drawableWaves(waves)) {
        throw new Error("the wave list is not a list of waves");
      }
      const visible = visibleWaves(waves, showAll);
      const wanted = visible.find((head) => head.wave === selected);
      const chosen = wanted ?? visible[0];
      if (chosen === undefined) {
        return { kind: "project", project: route.id, waves, view: undefined };
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
      return { kind: "project", project: route.id, waves, view };
    }
    return { kind: "unknown" };
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
      return projectList(data.projects, clock());
    }
    if (data.kind === "project") {
      const model = { ...data, showAll, selected, view: viewFor(data) };
      return wavePanel(model, clock(), {
        onSelect: (waveId) => {
          selected = waveId;
          void refreshOnce().then(schedule, schedule);
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
    const children = [];
    if (data !== undefined && note !== "") {
      children.push(
        el("p", { attrs: { class: "note", role: "status" }, text: note }),
      );
    }
    children.push(body());
    root.replaceChildren(...children);
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
    doc.addEventListener("visibilitychange", onVisibility);
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
  }

  return { start, stop, refresh, route };
}

export function boot(globals) {
  const app = createApp(globals);
  app.start();
  return app;
}
