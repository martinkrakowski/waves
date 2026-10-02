import { drawableAttention } from "./attention.js";
import { createApi } from "./api.js";
import { el } from "./dom.js";
import { drawableProjectLanes } from "./project-lanes.js";
import { drawableProjects } from "./projects.js";
import { isProjectId, isWaveId } from "./patterns.js";
import { parseQuery } from "./query.js";
import { shell } from "./shell.js";
import { renderFleet } from "./views/fleet.js";
import { hrefFor, renderProject } from "./views/project.js";

export const REFRESH_MS = 10_000;

const ROOT_ID = "root";
const PROJECT_PREFIX = "/p/";
const OFFLINE_NOTE = "offline, retrying";
const LOADING = "Loading…";

/** `/p/<id>` or `/p/<id>/w/<wave>`: the server serves the page on both. */
const PROJECT_PATH = /^\/p\/([^/]+)(\/w\/([^/]+))?$/;

/** The tags a reader is already typing into, where a `/` is a `/`. */
const TYPING = ["INPUT", "SELECT", "TEXTAREA"];

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
  let menuOpen = false;
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
   * The project list, which the menu lists on every route and the fleet page
   * draws as its body. A response the menu cannot show is a failed load, not an
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
   * What every project's lanes are asking for, which the menu counts and the
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
      // Not a page of ours, but the menu is: the reader still has to be able to
      // get to a project from here, and the menu's two lists are the whole of
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
    // menu's two, then every lane of every wave of the project the route names.
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
      // said at once and stays said while the menu's data loads or fails.
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
      return renderProject(
        { lanes: data.lanes, wave: route.wave, query },
        clock(),
        projectHandlers(),
      );
    }
    return el("p", { attrs: { class: "empty" }, text: "No such project." });
  }

  /**
   * The two things a filter on a project's page can ask for. Both are
   * navigations, so a filter is a place a reader can be sent, read aloud, copied
   * or opened in a new tab, and the address is where the filter lives rather than
   * inside a control that a reload forgets. Typing replaces the address rather
   * than pushing onto it: a reader typing one word must not fill the history
   * with one entry per keystroke.
   */
  function projectHandlers() {
    return {
      onFilter: (patch) => {
        navigate(
          hrefFor(route.id, route.wave, {
            ...query,
            ...patch,
            lane: undefined,
          }),
        );
      },
      onSearch: (text) => {
        navigate(
          hrefFor(route.id, route.wave, {
            ...query,
            q: text === "" ? undefined : text,
            lane: undefined,
          }),
          { replace: true },
        );
      },
    };
  }

  /**
   * The control inside the page the view gave this key, compared by value and
   * never by a selector built from it: a key is one this page's own markup
   * carries, and a selector is the one place an API string would end up in a
   * query.
   */
  function controlWith(key) {
    return [...root.querySelectorAll("[data-key]")].find(
      (element) => element.getAttribute("data-key") === key,
    );
  }

  /**
   * The link the reader's focus is on — its address, and which of the links
   * with that address it is — so a redraw can put them back on the same one.
   * Several links share an address (the menu and a card both lead to a project),
   * and landing on the first of them would pull a reader out of the list they
   * were working down. `draw()` replaces every node, which on the ten-second
   * refresh would otherwise take the focus with it and drop a keyboard reader
   * at the top of the page. Compared by value, never by selector: an `href` is
   * an API string and does not belong in a query.
   *
   * A control is remembered by the key it was drawn with, and with its caret: a
   * reader typing in the search box would otherwise be dropped out of it on
   * every character. It is asked about first, because a `select` and an `input`
   * carry no address at all.
   */
  function focusedLink() {
    const active = doc.activeElement;
    if (active === null || !root.contains(active)) {
      return undefined;
    }
    const key = active.getAttribute("data-key");
    if (key !== null && key !== "nav") {
      const start = active.selectionStart;
      return typeof start === "number"
        ? { key, start, end: active.selectionEnd }
        : { key };
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
   * Puts the focus back where it was: a control by its key, a link by its
   * address and its place among the links with that address, without scrolling
   * to it — a reader who scrolled away is not dragged back every ten seconds. A
   * control the redraw did not draw is left alone, which is what happens when
   * the scope emptied and the toolbar went with it.
   */
  function refocus(focused) {
    if (focused === undefined) {
      return;
    }
    if (focused.key !== undefined) {
      const control = controlWith(focused.key);
      if (control === undefined) {
        return;
      }
      control.focus({ preventScroll: true });
      if (focused.start !== undefined) {
        control.setSelectionRange(focused.start, focused.end);
      }
      return;
    }
    const same = [...root.querySelectorAll("a")].filter(
      (anchor) => anchor.getAttribute("href") === focused.href,
    );
    same[focused.nth]?.focus({ preventScroll: true });
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
          menuOpen,
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
      // Every pass that answered carries both of the menu's lists, on every
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
   * Where the browser is now, and what the view asked for, read from it.
   * Reading it starts no generation: only a pass that is about to be asked for
   * needs one, and a change of what is drawn — a wave, a filter, a lane — asks
   * for nothing new.
   */
  function read() {
    route = routeOf(location.pathname);
    query = parseQuery(location.search);
  }

  /** Whether a route is another wave of the project already on screen. */
  function sameProject(was, now) {
    return (
      was.kind === "project" && now.kind === "project" && was.id === now.id
    );
  }

  /**
   * Reads the address again and draws what it now says.
   *
   * What a pass requests depends on the route's kind, its id and `all` — and on
   * nothing else. So when all three are the same as they were and the answer is
   * already held, the reader chose another wave, another filter or another lane
   * of the same listing, and the page is redrawn from the data in hand: no
   * request, no new generation, and no note cleared. A page that is offline
   * stays marked offline through a filter, because no pass follows to say
   * otherwise; the next one will.
   *
   * In every other case the route or the listing is not the one on screen, so
   * what belonged to the route being left is forgotten, the note with it — a
   * note about the page the reader has just left is not a note about this one —
   * and a pass is started. The menu's list is never cleared at all: it is the
   * same for every route, and blanking it to "Loading…" on each click, and for
   * ever on a route that fetches nothing, was a page that had lost the one thing
   * it knew. The menu itself is shut on every navigation, whichever branch: a
   * reader who went somewhere has finished choosing where to go.
   */
  function reread() {
    const was = route;
    const wasAll = query.all;
    read();
    menuOpen = false;
    if (data !== undefined && sameProject(was, route) && wasAll === query.all) {
      draw();
      return;
    }
    generation += 1;
    note = "";
    // The lanes on screen were asked for under one `all`. Under the other they
    // are a different list, so they are not kept: a table of retained waves
    // beside a strip that says every wave is shown would be two answers at once.
    if (!sameProject(was, route) || wasAll !== query.all) {
      data = undefined;
    }
    draw();
    void refreshOnce().then(schedule, schedule);
  }

  /**
   * The page's own navigation, in place: a `push` so the reader can come back,
   * or a `replace` for an address that changes as it is typed, which would
   * otherwise put one entry per keystroke in front of the reader's back button.
   */
  function navigate(url, options = {}) {
    const path = ownPath(url);
    if (path === undefined) {
      return;
    }
    if (path === `${location.pathname}${location.search}`) {
      return;
    }
    if (options.replace === true) {
      history.replaceState(null, "", path);
    } else {
      history.pushState(null, "", path);
    }
    reread();
  }

  function onPopState() {
    reread();
  }

  /**
   * A plain primary click on one of the app's own links is this page's
   * navigation; every other click is the browser's. A modified click still
   * opens a tab, and a repository link still leaves the page.
   *
   * A click outside the menu closes it, whatever the click was for: a menu left
   * open under a click elsewhere would go on covering the page the reader is
   * reaching for. The redraw comes first and the click carries on into the logic
   * below, so a link outside the menu still navigates.
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
    if (menuOpen && node.closest("details.menu") === null) {
      menuOpen = false;
      draw();
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

  /**
   * `/` goes to the search box, the way it does everywhere else a reader expects
   * it to — and only when the reader is not already in a control, so a slash in
   * the search box, or a `#` and a slash a reader is typing into a seat, is a
   * slash and not a command. A page with no search box is left alone, and a
   * `/` with Command, Control or Alt is left to the browser, which has its own
   * meaning for it. Shift is not refused: on several keyboard layouts it is how
   * a slash is typed.
   */
  function onKey(event) {
    if (root === null || event.key !== "/") {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const active = doc.activeElement;
    if (active !== null && TYPING.includes(active.tagName)) {
      return;
    }
    const box = controlWith("q");
    if (box === undefined) {
      return;
    }
    event.preventDefault();
    box.focus();
  }

  /**
   * The reader opened or closed the projects menu themselves, and the state has
   * to follow them: `draw()` reads nothing from the document, so a redraw on the
   * ten-second pass would otherwise shut a menu the reader is reading.
   *
   * `toggle` does not bubble, so it is taken in the capture phase, and only the
   * shell's own menu is heard: another `details` on the page is not this menu.
   * Nothing is drawn here — a native control has already moved itself, and the
   * next draw says the same thing.
   */
  function onToggle(event) {
    const node = event.target;
    if (node.tagName === "DETAILS" && node.getAttribute("class") === "menu") {
      menuOpen = node.open;
    }
  }

  /**
   * Escape closes the projects menu and puts the focus back on its summary: a
   * menu shut from the keyboard has to leave the reader where they can Tab on
   * from it, and the summary is where they were when they opened it. It is a
   * listener of its own because it is about the frame the reader is in, while
   * `onKey` is about the page under it.
   *
   * An Escape something else already took — the search box clearing itself, a
   * dialog closing — is that thing's, and is left to it: one key press does one
   * thing.
   */
  function onMenuKey(event) {
    if (event.defaultPrevented) {
      return;
    }
    if (event.key === "Escape" && menuOpen) {
      menuOpen = false;
      draw();
      controlWith("menu")?.focus();
    }
  }

  function start() {
    stopped = false;
    read();
    generation += 1;
    doc.addEventListener("visibilitychange", onVisibility);
    doc.addEventListener("keydown", onKey);
    doc.addEventListener("keydown", onMenuKey);
    win.addEventListener("popstate", onPopState);
    if (root !== null) {
      root.addEventListener("click", onClick);
      root.addEventListener("toggle", onToggle, true);
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
    doc.removeEventListener("keydown", onKey);
    doc.removeEventListener("keydown", onMenuKey);
    win.removeEventListener("popstate", onPopState);
    if (root !== null) {
      root.removeEventListener("click", onClick);
      root.removeEventListener("toggle", onToggle, true);
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
