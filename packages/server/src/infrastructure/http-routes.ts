import { isProjectId, isWaveId } from "@hexagen-monaco/waves-contract";

import { resolveStaticFile, type StaticFile } from "./http-static.js";

export const HEALTH_PATH = "/healthz";
export const READY_PATH = "/readyz";
export const ATTENTION_PATH = "/api/v1/attention";
export const API_PREFIX = "/api/v1/projects";
export const MAX_URL_BYTES = 2048;

export type Route =
  | { readonly kind: "health" }
  | { readonly kind: "ready" }
  | { readonly kind: "attention" }
  | { readonly kind: "projects" }
  | { readonly kind: "project"; readonly project: string }
  | { readonly kind: "waves"; readonly project: string }
  | { readonly kind: "lanes"; readonly project: string }
  | { readonly kind: "wave"; readonly project: string; readonly wave: string }
  | { readonly kind: "index" }
  | { readonly kind: "file"; readonly file: StaticFile }
  | { readonly kind: "missing" };

/**
 * Which methods answer each path, and therefore what a 405 on it announces.
 * The two write routes on a wave and the project collection and the single
 * project are the only ones a write is allowed on; everything else is a read.
 */
const ALLOWED: Readonly<Record<Route["kind"], string>> = {
  health: "GET, HEAD",
  ready: "GET, HEAD",
  attention: "GET, HEAD",
  projects: "GET, HEAD, POST",
  project: "DELETE",
  waves: "GET, HEAD",
  lanes: "GET, HEAD",
  wave: "GET, HEAD, PUT, DELETE",
  index: "GET, HEAD",
  file: "GET, HEAD",
  missing: "GET, HEAD",
};

export type WriteRoute =
  | { readonly kind: "push"; readonly project: string; readonly wave: string }
  | { readonly kind: "drop"; readonly project: string; readonly wave: string }
  | { readonly kind: "register" }
  | { readonly kind: "removeProject"; readonly project: string };

export function allowOf(matched: Route): string {
  return ALLOWED[matched.kind];
}

/** Registration and project removal are the two writes an admin token answers. */
export function isAdminWrite(route: WriteRoute): boolean {
  return route.kind === "register" || route.kind === "removeProject";
}

/**
 * The write a method performs on a path, or undefined when the method is not a
 * write that path accepts: a 405 is then the answer, carrying that path's own
 * `Allow`. Registering and removing a project are admin writes; pushing and
 * removing a wave are project writes, answered with that project's own token.
 */
export function writeRouteOf(
  matched: Route,
  method: string,
): WriteRoute | undefined {
  if (method === "POST" && matched.kind === "projects") {
    return { kind: "register" };
  }
  if (method === "DELETE" && matched.kind === "project") {
    return { kind: "removeProject", project: matched.project };
  }
  if (method === "PUT" && matched.kind === "wave") {
    return { kind: "push", project: matched.project, wave: matched.wave };
  }
  if (method === "DELETE" && matched.kind === "wave") {
    return { kind: "drop", project: matched.project, wave: matched.wave };
  }
  return undefined;
}

export function pathOf(target: string): string {
  const cut = target.indexOf("?");
  return cut === -1 ? target : target.slice(0, cut);
}

/**
 * The part of a target after its first `?`, or `""` when it carries none. Every
 * read route ignores its query string; the one route that reads it takes the
 * query from here.
 */
export function queryOf(target: string): string {
  const cut = target.indexOf("?");
  return cut === -1 ? "" : target.slice(cut + 1);
}

export function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

/**
 * Maps a request path to exactly one route. An id or a wave the contract's
 * predicates refuse is not a route at all, so an unvalidated segment never
 * reaches the store. `/`, `/p/<id>` and `/p/<id>/w/<wave>` are the entry points
 * of the page served from `public/index.html`; every other path is a static file
 * or nothing.
 */
export function route(pathname: string, root: string): Route {
  if (pathname === HEALTH_PATH) {
    return { kind: "health" };
  }
  if (pathname === READY_PATH) {
    return { kind: "ready" };
  }
  if (pathname === ATTENTION_PATH) {
    return { kind: "attention" };
  }
  const parts = pathname.split("/");
  if (parts.slice(0, 4).join("/") === API_PREFIX) {
    if (parts.length === 4) {
      return { kind: "projects" };
    }
    const project = String(parts[4]);
    if (isProjectId(project)) {
      if (parts.length === 5) {
        return { kind: "project", project };
      }
      if (parts.length === 6 && parts[5] === "waves") {
        return { kind: "waves", project };
      }
      if (parts.length === 6 && parts[5] === "lanes") {
        return { kind: "lanes", project };
      }
      if (
        parts.length === 7 &&
        parts[5] === "waves" &&
        isWaveId(String(parts[6]))
      ) {
        return { kind: "wave", project, wave: String(parts[6]) };
      }
    }
  }
  if (
    pathname === "/" ||
    (parts.length === 3 && parts[1] === "p" && isProjectId(String(parts[2]))) ||
    (parts.length === 5 &&
      parts[1] === "p" &&
      isProjectId(String(parts[2])) &&
      parts[3] === "w" &&
      isWaveId(String(parts[4])))
  ) {
    return { kind: "index" };
  }
  const file = resolveStaticFile(root, pathname);
  if (file === undefined) {
    return { kind: "missing" };
  }
  return { kind: "file", file };
}
