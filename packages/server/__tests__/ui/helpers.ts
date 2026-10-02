import { expect } from "vitest";

import type { ApiResponse, FetchLike } from "../../public/api.js";
import type { ProjectModel } from "../../public/views/project.js";
import { renderProject } from "../../public/views/project.js";

import { NOW_MS, projectLanes } from "./fixtures.js";

/** Every tag the page shell or a view in `public/` is allowed to create. */
export const ALLOWED_TAGS: ReadonlySet<string> = new Set([
  "A",
  "ARTICLE",
  "ASIDE",
  "BUTTON",
  "CODE",
  "DD",
  "DETAILS",
  "DIALOG",
  "DIV",
  "DL",
  "DT",
  "H1",
  "H2",
  "H3",
  "HEADER",
  "INPUT",
  "LABEL",
  "LI",
  "MAIN",
  "METER",
  "NAV",
  "OPTION",
  "P",
  "PRE",
  "SECTION",
  "SELECT",
  "SMALL",
  "SPAN",
  "SUMMARY",
  "TABLE",
  "TBODY",
  "TD",
  "TH",
  "THEAD",
  "TR",
  "UL",
]);

/** Attributes no data value may ever reach, whatever the tag. */
const BANNED_ATTRIBUTES: ReadonlySet<string> = new Set([
  "style",
  "srcdoc",
  "src",
  "srcset",
  "formaction",
  "xlink:href",
  "background",
]);

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

/** `//host` and `/\host`: a backslash is a slash for every special scheme. */
const PROTOCOL_RELATIVE = /^[/\\]{2}/;

export function freshRoot(): HTMLElement {
  document.body.replaceChildren();
  document.title = "waves";
  const host = document.createElement("div");
  host.setAttribute("id", "root");
  document.body.append(host);
  return host;
}

export function root(): HTMLElement {
  const found = document.getElementById("root");
  expect(found).not.toBeNull();
  if (found === null) {
    throw new Error("no #root in the document");
  }
  return found as HTMLElement;
}

export function textOf(node: Element | null): string {
  return node === null ? "" : (node.textContent ?? "");
}

export function tagsIn(node: Element): string[] {
  return Array.from(node.querySelectorAll("*"), (element) => element.tagName);
}

export function textsOf(node: Element, selector: string): string[] {
  return Array.from(node.querySelectorAll(selector), (element) =>
    textOf(element),
  );
}

export function oneOf(node: Element, selector: string): Element | null {
  const found = node.querySelectorAll(selector);
  expect(found.length).toBeLessThanOrEqual(1);
  return found[0] ?? null;
}

/**
 * The invariants the CSP alone cannot give: only tags from `ALLOWED_TAGS`, no
 * `on*` or other dangerous attribute, and no `href` that is protocol-relative
 * or carries a scheme other than `https:`. An attribute *value* is never parsed
 * as HTML, so a payload in a `title` is inert; the test that feeds one counts
 * those titles instead of banning them.
 */
export function assertNoInjectedMarkup(): void {
  for (const element of document.querySelectorAll("*")) {
    for (const name of element.getAttributeNames()) {
      expect(name.startsWith("on")).toBe(false);
      expect(BANNED_ATTRIBUTES.has(name)).toBe(false);
    }
  }
  const host = document.getElementById("root");
  expect(host).not.toBeNull();
  if (host === null) {
    return;
  }
  expect(ALLOWED_TAGS.has(host.tagName)).toBe(true);
  for (const element of host.querySelectorAll("*")) {
    expect(ALLOWED_TAGS.has(element.tagName)).toBe(true);
  }
  for (const anchor of document.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href") ?? "";
    expect(PROTOCOL_RELATIVE.test(href)).toBe(false);
    const scheme = SCHEME.exec(href);
    if (scheme === null) {
      expect(href.startsWith("/")).toBe(true);
    } else {
      expect((scheme[1] ?? "").toLowerCase()).toBe("https");
    }
  }
}

export interface Answer {
  readonly status: number;
  readonly body?: unknown;
  /** `gatedFetch` only holds a response back when this is left unset. */
  readonly hold?: boolean;
}

export type FetchHandler = (path: string) => Answer;

export interface FetchStub extends FetchLike {
  readonly calls: string[];
}

export function fetchStub(handler: FetchHandler): FetchStub {
  const calls: string[] = [];
  return Object.assign(
    async (path: string): Promise<ApiResponse> => {
      calls.push(path);
      const answer = handler(path);
      return {
        ok: answer.status >= 200 && answer.status < 300,
        status: answer.status,
        json: () => Promise.resolve(answer.body),
      };
    },
    { calls },
  );
}

export function throwingFetch(): FetchStub {
  const calls: string[] = [];
  return Object.assign(
    (path: string): Promise<ApiResponse> => {
      calls.push(path);
      return Promise.reject(new Error(`network is down for ${path}`));
    },
    { calls },
  );
}

export interface GatedFetch extends FetchStub {
  /** Answers every response that is still waiting, and all of them at once. */
  release(): void;
  /** How many responses are still waiting for `release`. */
  pending(): number;
}

/** A fetch whose bodies arrive only when the test says so. */
export function gatedFetch(handler: FetchHandler): GatedFetch {
  const calls: string[] = [];
  const waiting = new Set<() => void>();
  const held = (answer: Answer): Promise<unknown> =>
    new Promise((resolve) => {
      waiting.add(() => {
        resolve(answer.body);
      });
    });
  const release = (): void => {
    for (const answer of [...waiting]) {
      answer();
    }
    waiting.clear();
  };
  const impl: GatedFetch = Object.assign(
    (path: string): Promise<ApiResponse> => {
      calls.push(path);
      const answer = handler(path);
      const body =
        answer.hold === false ? Promise.resolve(answer.body) : held(answer);
      return Promise.resolve({
        ok: answer.status >= 200 && answer.status < 300,
        status: answer.status,
        json: () => body,
      });
    },
    { calls, release, pending: () => waiting.size },
  );
  return impl;
}

export interface ScheduledTimer {
  readonly handle: number;
  readonly callback: () => void;
  readonly delayMs: number;
}

export interface TimerStub {
  readonly scheduled: ScheduledTimer[];
  readonly cleared: number[];
  setTimer(callback: () => void, delayMs: number): number;
  clearTimer(handle: unknown): void;
  runLast(): void;
}

export function timerStub(): TimerStub {
  const scheduled: ScheduledTimer[] = [];
  const cleared: number[] = [];
  let next = 0;
  return {
    scheduled,
    cleared,
    setTimer: (callback, delayMs) => {
      next += 1;
      scheduled.push({ handle: next, callback, delayMs });
      return next;
    },
    clearTimer: (handle) => {
      const at = scheduled.findIndex((entry) => entry.handle === handle);
      if (at >= 0) {
        cleared.push(scheduled[at]?.handle ?? 0);
        scheduled.splice(at, 1);
      }
    },
    runLast: () => {
      const entry = scheduled[scheduled.length - 1];
      if (entry === undefined) {
        throw new Error("no timer is armed");
      }
      scheduled.splice(scheduled.length - 1, 1);
      entry.callback();
    },
  };
}

export function setHidden(hidden: boolean): void {
  Object.defineProperty(document, "hidden", {
    value: hidden,
    configurable: true,
  });
}

export function visible(): void {
  document.dispatchEvent(new Event("visibilitychange"));
}

/** Lets every pending promise in the app's refresh settle. */
export function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export interface BrowserGlobals {
  /**
   * ONE object, mutable: `history.pushState` writes to it, and a test navigates
   * by moving it. A fresh object per read would let the app navigate and then
   * re-read the address it started from.
   */
  readonly location: { pathname: string; search: string };
  readonly history: {
    pushState(data: unknown, unused: string, url: string): void;
    replaceState(data: unknown, unused: string, url: string): void;
  };
  readonly win: {
    addEventListener(type: "popstate", listener: () => void): void;
    removeEventListener(type: "popstate", listener: () => void): void;
  };
  /** Every URL a `pushState` was given, in order. */
  readonly pushes: string[];
  /** Every URL a `replaceState` was given, in order. */
  readonly replaces: string[];
  /** How many `popstate` listeners the app has attached. */
  readonly popstates: number;
  popstate(): void;
}

/**
 * The browser's own objects, as the app is handed them: a location, a history
 * that moves that location, and a window carrying the popstate listeners. Never
 * the real `window.location` or `window.history`, and never asserted on either.
 */
export function browserGlobals(pathname = "/", search = ""): BrowserGlobals {
  const location = { pathname, search };
  const pushes: string[] = [];
  const replaces: string[] = [];
  const listeners: (() => void)[] = [];
  const move = (url: string): void => {
    const target = new URL(url, "http://test");
    location.pathname = target.pathname;
    location.search = target.search;
  };
  const history = {
    pushState: (_data: unknown, _unused: string, url: string): void => {
      pushes.push(url);
      move(url);
    },
    replaceState: (_data: unknown, _unused: string, url: string): void => {
      replaces.push(url);
      move(url);
    },
  };
  const win = {
    addEventListener: (type: string, listener: () => void): void => {
      expect(type).toBe("popstate");
      listeners.push(listener);
    },
    removeEventListener: (type: string, listener: () => void): void => {
      expect(type).toBe("popstate");
      const at = listeners.indexOf(listener);
      if (at >= 0) {
        listeners.splice(at, 1);
      }
    },
  };
  return {
    location,
    history,
    win,
    pushes,
    replaces,
    get popstates() {
      return listeners.length;
    },
    popstate: () => {
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}

/**
 * Draws one project's page with the given model, defaulting to the whole
 * project with one wave and one lane, and returns the host it was drawn into.
 * The markup invariants are asserted on the way out, so every view test that
 * uses this harness also gets `assertNoInjectedMarkup`.
 */
export function renderProjectView(
  model: Partial<ProjectModel> = {},
  nowMs: number = NOW_MS,
): HTMLElement {
  const full: ProjectModel = {
    lanes: projectLanes(),
    wave: undefined,
    query: { all: false },
    ...model,
  };
  const host = freshRoot();
  host.append(renderProject(full, nowMs));
  assertNoInjectedMarkup();
  return host;
}
