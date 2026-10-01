import { createApi } from "./api.js";
import { el } from "./dom.js";
import { projectList } from "./projects.js";
import { visibleWaves, wavePanel } from "./wave.js";

export const REFRESH_MS = 10_000;

const ROOT_ID = "root";
const PROJECT_PREFIX = "/p/";
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
    const id = decodeId(pathname);
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
      if (!Array.isArray(projects)) {
        throw new Error("the project list is not a list");
      }
      return { kind: "projects", projects };
    }
    if (route.kind === "project") {
      const waves = await api.waves(route.id);
      if (waves === undefined) {
        return { kind: "missing" };
      }
      const visible = visibleWaves(waves, showAll);
      const wanted = visible.find((head) => head.wave === selected);
      const chosen = wanted ?? visible[0];
      if (chosen === undefined) {
        return { kind: "project", project: route.id, waves, view: undefined };
      }
      selected = chosen.wave;
      return {
        kind: "project",
        project: route.id,
        waves,
        view: await api.wave(route.id, chosen.wave),
      };
    }
    return { kind: "unknown" };
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
      return wavePanel({ ...data, showAll, selected }, clock(), {
        onSelect: (waveId) => {
          selected = waveId;
          void refresh();
        },
        onToggleAll: () => {
          showAll = !showAll;
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

  async function refresh() {
    try {
      data = await load();
      note = "";
      draw();
    } catch {
      note = OFFLINE_NOTE;
      draw();
    }
  }

  /**
   * One refresh at a time. A caller that arrives while one is in flight waits
   * for that one rather than starting a second, which is what keeps the timer
   * callback and a visibility change from chaining two loops.
   */
  async function refreshOnce() {
    if (inFlight !== undefined) {
      return inFlight;
    }
    inFlight = refresh();
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
      void refreshOnce().then(schedule);
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
    void refreshOnce().then(schedule);
  }

  function start() {
    stopped = false;
    doc.addEventListener("visibilitychange", onVisibility);
    draw();
    void refreshOnce();
    schedule();
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
