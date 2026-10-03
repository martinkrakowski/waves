import { drawableAttention } from "./attention.js";
import { createApi } from "./api.js";
import { digestOf } from "./digest.js";
import { el } from "./dom.js";
import { drawableProjectLanes } from "./project-lanes.js";
import { drawableProjects } from "./projects.js";
import { isProjectId, isWaveId } from "./patterns.js";
import { parseQuery } from "./query.js";
import { shell } from "./shell.js";
import { drawableStatus } from "./status.js";
import { renderDrawer } from "./views/drawer.js";
import { renderFleet } from "./views/fleet.js";
import {
  hrefFor,
  filterRows,
  renderProject,
  scopeOf,
  sortRows,
  staleWavesOf,
} from "./views/project.js";
import { drawableWave } from "./wave.js";

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
    /**
     * The browser's clipboard, or nothing at all: outside a secure context it is
     * not there, and a page with no clipboard is the "copy failed" case rather
     * than a page that pretends.
     */
    clipboard,
    refreshMs = REFRESH_MS,
  } = deps;
  const api = createApi(fetchImpl);
  const root = doc.getElementById(ROOT_ID);
  let route = routeOf(location.pathname);
  let query = parseQuery(location.search);
  let data = undefined;
  let note = "";
  let menuOpen = false;
  /**
   * What the last copy of the digest said. Cleared by every navigation, in both
   * of its branches: an address that changed is a page the note is no longer
   * about, and a note left standing would claim a copy this page did not do.
   */
  let copied = "";
  /**
   * Which copy may still speak: bumped by every copy and every navigation, so a
   * copy that settles late — after another copy, or after the reader left and
   * came back to the same address — says nothing about a page it did not copy.
   */
  let copyCount = 0;
  /** Whether the press that started the current click landed on the backdrop. */
  let pressedOnBackdrop = false;
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
   * The dialog the drawer is drawn in, beside `#root` rather than inside it: the
   * page's own chrome is the root's, and a modal over it is not. There is no
   * dialog when there is no root, and every function below is reached from
   * `draw()` after its own `root === null` return or from a listener `start()`
   * put on this element, so none of them is ever called without one.
   */
  const dialog =
    root === null
      ? undefined
      : el("dialog", {
          attrs: { class: "lane-drawer", "aria-labelledby": "drawer-title" },
        });
  /**
   * `<project>/<wave>/<lane>` while the drawer is showing something, and
   * `undefined` while it is closed. It is the whole of "which lane is open": a
   * second pass for the same key leaves the drawer alone, and the ten-second
   * refresh is exactly that.
   */
  let drawerKey = undefined;
  let drawerModel = undefined;
  /**
   * Counted up on every open, on every close and on every `stop()`, and read by
   * the answer to a wave request when it settles: an answer for a drawer that is
   * no longer the one on screen paints nothing.
   */
  let drawerGeneration = 0;

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
   * What the project last said about itself, which the project page draws as a
   * panel. A 404 is "it has pushed none", not a failure: the status is the one
   * read on this page that a project may legitimately never make, and a page that
   * said "offline" because a project was quiet would be wrong about the project.
   * Any other failure is a failed load, exactly as the listing's is, and a status
   * the panel could not draw is one too.
   */
  async function loadStatus(projectId) {
    const status = await api.status(projectId);
    if (status === undefined) {
      return undefined;
    }
    if (!drawableStatus(status)) {
      throw new Error("the project status is not a project status");
    }
    return status;
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
    // Four calls in one Promise.all, in the order the page needs them: the menu's
    // two, then every lane of every wave of the project the route names, then
    // what that project last said about itself. The first three are one subject:
    // the wave strip and the lane table are two views of the same listing, and a
    // second request would be a second chance for the two to disagree. The status
    // is about the project rather than about any wave of it, so it is a fourth
    // read — beside the listing, in the same pass, rather than after it.
    const [projects, attention, lanes, status] = await Promise.all([
      loadProjects(),
      loadAttention(),
      api.lanes(at.id, asked.all),
      loadStatus(at.id),
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
    if (status !== undefined && status.status.project !== at.id) {
      throw new Error("the project status is another project's");
    }
    return {
      kind: "project",
      project: at.id,
      projects,
      attention,
      lanes,
      status,
    };
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
        {
          lanes: data.lanes,
          status: data.status,
          wave: route.wave,
          query,
          copied,
        },
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
      onCopy,
    };
  }

  /**
   * The address this view is at, as the browser holds it: never a decoded one, so
   * that a seat or a search in the query goes into the digest in the only form it
   * can be read back in.
   */
  function address() {
    return `${location.origin}${location.pathname}${location.search}`;
  }

  /** What the copy did, said beside the button — unless a later copy or a navigation came since. */
  function said(text, mine) {
    if (mine !== copyCount) {
      return;
    }
    copied = text;
    draw();
  }

  /**
   * Puts a plain-text digest of the rows on screen on the clipboard.
   *
   * The rows are the ones the table shows, in the table's order, over the scope
   * the route names: the digest answers "what does this page say", and a digest
   * of rows the reader filtered away answers a question nobody asked. The
   * clipboard is the browser's own, so the promise is not this page's to keep:
   * a refusal, a rejection and a browser with no clipboard are all the same
   * thing to a reader — the copy did not happen — and a note that settles after
   * the address has moved on says nothing at all, because it would be about a
   * page that is no longer on screen.
   */
  function onCopy() {
    const lanes = data.lanes;
    const scope = scopeOf(lanes, route.wave);
    copyCount += 1;
    const mine = copyCount;
    const url = address();
    const text = digestOf({
      project: route.id,
      wave: route.wave,
      shown: sortRows(filterRows(scope, query), lanes.waves),
      inScope: scope.length,
      staleWaves: staleWavesOf(lanes, route.wave, query.all).map(
        (head) => head.wave,
      ),
      url,
    });
    if (clipboard === undefined) {
      said("Copy failed", mine);
      return;
    }
    try {
      void clipboard.writeText(text).then(
        () => {
          said("Digest copied", mine);
        },
        () => {
          said("Copy failed", mine);
        },
      );
    } catch {
      // A clipboard that throws rather than refusing is the same answer.
      said("Copy failed", mine);
    }
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

  /**
   * The lane the address names, with the wave that makes it one lane: the route's
   * own project and wave, and the query's lane. A `?lane=` with no wave behind it
   * only marks a row, as it always has — a lane id recurs across waves, so on its
   * own it names no single lane — and a route with no listing drawn on it names
   * nothing at all.
   */
  function wantedDrawer() {
    if (route.kind !== "project" || route.wave === undefined) {
      return undefined;
    }
    if (
      query.lane === undefined ||
      data === undefined ||
      data.kind !== "project"
    ) {
      return undefined;
    }
    return { project: route.id, wave: route.wave, lane: query.lane };
  }

  /**
   * What the listing says about that lane: its reasons, or none at all when the
   * listing holds no row for it. The repository is the project's own, and is the
   * only other thing the drawer takes from the listing.
   */
  function drawerModelFor(wanted, state, view) {
    const row = data.lanes.lanes.find(
      (entry) => entry.wave === wanted.wave && entry.id === wanted.lane,
    );
    return {
      state,
      project: wanted.project,
      repo: data.lanes.project.repo,
      wave: wanted.wave,
      lane: wanted.lane,
      reasons: row === undefined ? [] : row.reasons,
      view,
    };
  }

  /** The same drawer in another state, keeping what the listing said about it. */
  function restate(state, view) {
    drawerModel = { ...drawerModel, state, view };
    return drawerModel;
  }

  /** The drawer's own Close control, found by the key it is drawn with. */
  function closeButton() {
    return [...dialog.querySelectorAll("[data-key]")].find(
      (element) => element.getAttribute("data-key") === "close",
    );
  }

  /**
   * Draws the model into the dialog.
   *
   * The focus is read before the children are replaced, because a node that has
   * been removed is no longer the active element: a reader who never left Close
   * has it focused again on the button that replaced it, and a reader who moved
   * somewhere else is left exactly where they moved to.
   *
   * `renderDrawer` reads a shape it did not choose, so a paint never throws into
   * the page either: a lane it cannot read is drawn as the failed read it is, and
   * nothing half-built ever reaches the document.
   */
  function paint(keepClose) {
    const active = doc.activeElement;
    const held =
      keepClose === true &&
      active !== null &&
      active.getAttribute("data-key") === "close";
    let node;
    try {
      node = renderDrawer(drawerModel, clock(), { onClose: closeDrawer });
    } catch {
      node = renderDrawer(restate("failed"), clock(), { onClose: closeDrawer });
    }
    dialog.replaceChildren(node);
    if (held) {
      // The button just drawn is there whenever the one that was focused was:
      // both are the same Close, from the same view.
      closeButton().focus({ preventScroll: true });
    }
  }

  /**
   * The lane's own link in the table this redraw drew, or nothing: a filter that
   * hides the row leaves the reader's focus alone rather than dropping it at the
   * top of the page. Compared by value, never by a selector built from the
   * address, which is an API string.
   */
  function focusRow(href) {
    const row = [...root.querySelectorAll("a")].find(
      (anchor) =>
        anchor.getAttribute("href") === href && anchor.closest("tr") !== null,
    );
    row?.focus({ preventScroll: true });
  }

  /**
   * What the wave route answered, as the drawer says it. A wave this project does
   * not hold any more is gone; an answer that is not a wave, or one for a wave
   * other than the one asked for, could not be read; a wave that holds no lane
   * with that id holds no such lane.
   */
  function answeredState(wanted, answer) {
    if (answer === undefined) {
      return "gone";
    }
    if (!drawableWave(answer) || answer.envelope.wave !== wanted.wave) {
      return "failed";
    }
    return answer.envelope.lanes.some((lane) => lane.id === wanted.lane)
      ? "ready"
      : "missing";
  }

  /**
   * Asks for the one wave the lane is in, and paints the answer if this drawer is
   * still the one on screen when it settles. A wave request is the only one the
   * drawer makes, and it is made once per lane: the ten-second refresh redraws
   * the page and leaves this alone.
   */
  function loadWave(wanted, mine) {
    void api.wave(wanted.project, wanted.wave).then(
      (answer) => {
        if (mine !== drawerGeneration) {
          return;
        }
        const state = answeredState(wanted, answer);
        restate(state, state === "ready" ? answer : undefined);
        paint(true);
      },
      () => {
        if (mine === drawerGeneration) {
          restate("failed");
          paint(true);
        }
      },
    );
  }

  /**
   * Puts the drawer where the address says it should be. Called at the end of
   * every draw, because the address is what says: a reader typing `?lane=` gets
   * the drawer, a reader pressing Back loses it, and the ten-second refresh
   * redraws the page under a drawer it leaves exactly as it was — the snapshot
   * it was opened on, which is not the one to lose the reader's place in.
   */
  function syncDrawer() {
    const wanted = wantedDrawer();
    if (wanted === undefined) {
      if (drawerKey === undefined) {
        return;
      }
      const [project, wave, lane] = drawerKey.split("/");
      // The key goes first: the `close` event fires for this close as well, and a
      // dialog closing by its own arrangement must not close itself again.
      drawerKey = undefined;
      drawerModel = undefined;
      drawerGeneration += 1;
      // The address has already changed, so this is the query the redrawn table
      // writes its links from, with this lane put back into it.
      const rowHref = hrefFor(project, wave, { ...query, lane });
      if (dialog.open) {
        dialog.close();
      }
      // A closed dialog keeps nothing: a pusher's text has no business in the
      // document after a reader has closed the drawer that showed it.
      dialog.replaceChildren();
      focusRow(rowHref);
      return;
    }
    const key = `${wanted.project}/${wanted.wave}/${wanted.lane}`;
    if (key === drawerKey) {
      return;
    }
    drawerKey = key;
    drawerGeneration += 1;
    const mine = drawerGeneration;
    drawerModel = drawerModelFor(wanted, "loading", undefined);
    paint(false);
    if (!dialog.open) {
      dialog.showModal();
    }
    closeButton().focus({ preventScroll: true });
    loadWave(wanted, mine);
  }

  /**
   * The one way a reader closes the drawer: `lane` leaves the address and the
   * navigation does the rest, which is what keeps the address, the table and the
   * focus in step. A push rather than a replace, so Back opens the drawer again.
   * Two of the ways to close can fire for one key press, so a drawer that is not
   * open says nothing at all.
   */
  function closeDrawer() {
    if (drawerKey === undefined) {
      return;
    }
    navigate(hrefFor(route.id, route.wave, { ...query, lane: undefined }));
  }

  /** What a browser fires for `Esc` on a modal dialog. */
  function onDrawerCancel(event) {
    event.preventDefault();
    closeDrawer();
  }

  /**
   * `Esc` in this page's own code, so closing does not depend on how the browser
   * chooses to report it, and can be tested as this page's behaviour.
   */
  function onDrawerKey(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDrawer();
    }
  }

  /** Where the press began: a click is a backdrop click only if both ends were. */
  function onDrawerPress(event) {
    pressedOnBackdrop = event.target === dialog;
  }

  /**
   * A click on the dialog itself is a click on the backdrop: the padding is on
   * the drawer, so a click inside it has some other target and is left alone. A
   * press that began inside the drawer — selecting text in the tail, say — and
   * was released over the backdrop is answered by the browser as a click on the
   * dialog too, so the press is asked about as well.
   */
  function onDrawerClick(event) {
    if (event.target === dialog && pressedOnBackdrop) {
      closeDrawer();
    }
    pressedOnBackdrop = false;
  }

  /**
   * The dialog closed without this page closing it — the browser's own close, or a
   * form method, or anything else — so `lane` leaves the address too rather than
   * the address asking for a drawer that is not there.
   */
  function onDrawerClose() {
    if (drawerKey !== undefined) {
      closeDrawer();
    }
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
    syncDrawer();
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
    // One line for both branches below: whatever the address became, the note is
    // about a view that is no longer on screen.
    copied = "";
    copyCount += 1;
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
   * reaching for. It is shut where it stands, with no redraw: a redraw here would
   * replace the control the click is about to reach — a label's select, a search
   * box — before the browser acts on it. The click then carries on into the logic
   * below, so a link outside the menu still navigates.
   *
   * A link the app follows shuts it too, even one to the page already on screen,
   * which `navigate` ignores: the reader has chosen, so the menu is done.
   */
  /**
   * Shuts the menu in place: the state, and the element on screen, so the next
   * draw and the page agree without one being made now.
   */
  function shutMenu() {
    menuOpen = false;
    for (const details of root.querySelectorAll("details.menu")) {
      details.open = false;
    }
  }

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
    if (node.closest("details.menu") === null) {
      shutMenu();
    }
    const anchor = node.closest("a");
    if (anchor === null || anchor.getAttribute("data-key") !== "nav") {
      return;
    }
    shutMenu();
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
   * slash and not a command. A page with no search box is left alone, a `/` with
   * Command, Control or Alt is left to the browser, which has its own meaning for
   * it, and the drawer is left alone entirely: a reader reading one lane's
   * disagreements is not looking for the search box. Shift is not refused: on
   * several keyboard layouts it is how a slash is typed.
   */
  function onKey(event) {
    if (drawerKey !== undefined) {
      return;
    }
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
    if (dialog !== undefined) {
      // Beside the page rather than inside it, so a modal is over the whole
      // frame rather than over the part of it the root holds.
      root.after(dialog);
      dialog.addEventListener("cancel", onDrawerCancel);
      dialog.addEventListener("keydown", onDrawerKey);
      dialog.addEventListener("mousedown", onDrawerPress);
      dialog.addEventListener("click", onDrawerClick);
      dialog.addEventListener("close", onDrawerClose);
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
    if (dialog !== undefined) {
      // The listeners go before the close: a stopped page has no address to
      // change, and this close is the app's own rather than the browser's.
      dialog.removeEventListener("cancel", onDrawerCancel);
      dialog.removeEventListener("keydown", onDrawerKey);
      dialog.removeEventListener("mousedown", onDrawerPress);
      dialog.removeEventListener("click", onDrawerClick);
      dialog.removeEventListener("close", onDrawerClose);
      if (dialog.open) {
        dialog.close();
      }
      dialog.remove();
      // So that a `start()` on the same lane asks for its wave again rather than
      // finding the key of a drawer that is no longer in the document.
      drawerKey = undefined;
      drawerModel = undefined;
      drawerGeneration += 1;
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
