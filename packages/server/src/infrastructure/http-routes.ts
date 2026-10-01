import { isProjectId, isWaveId } from "@hexagen-monaco/waves-contract";

import { resolveStaticFile, type StaticFile } from "./http-static.js";

export const HEALTH_PATH = "/healthz";
export const API_PREFIX = "/api/v1/projects";
export const MAX_URL_BYTES = 2048;

export type Route =
  | { readonly kind: "health" }
  | { readonly kind: "projects" }
  | { readonly kind: "waves"; readonly project: string }
  | { readonly kind: "wave"; readonly project: string; readonly wave: string }
  | { readonly kind: "index" }
  | { readonly kind: "file"; readonly file: StaticFile }
  | { readonly kind: "missing" };

export function pathOf(target: string): string {
  const cut = target.indexOf("?");
  return cut === -1 ? target : target.slice(0, cut);
}

export function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

/**
 * Maps a request path to exactly one route. An id or a wave the contract's
 * predicates refuse is not a route at all, so an unvalidated segment never
 * reaches the store. `/` and `/p/<id>` are the entry points of the page served
 * from `public/index.html`; every other path is a static file or nothing.
 */
export function route(pathname: string, root: string): Route {
  if (pathname === HEALTH_PATH) {
    return { kind: "health" };
  }
  const parts = pathname.split("/");
  if (parts.slice(0, 4).join("/") === API_PREFIX) {
    if (parts.length === 4) {
      return { kind: "projects" };
    }
    const project = String(parts[4]);
    if (isProjectId(project)) {
      if (parts.length === 6 && parts[5] === "waves") {
        return { kind: "waves", project };
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
    (parts.length === 3 && parts[1] === "p" && isProjectId(String(parts[2])))
  ) {
    return { kind: "index" };
  }
  const file = resolveStaticFile(root, pathname);
  if (file === undefined) {
    return { kind: "missing" };
  }
  return { kind: "file", file };
}
