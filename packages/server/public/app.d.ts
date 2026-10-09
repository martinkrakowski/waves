import type { FetchLike } from "./api.js";

export type Route =
  | { readonly kind: "projects" }
  | {
      readonly kind: "project";
      readonly id: string;
      /** Present only on `/p/<id>/w/<wave>`. */
      readonly wave?: string;
    }
  | { readonly kind: "inbox" }
  | { readonly kind: "unknown" };

export interface AppGlobals {
  readonly doc: Document;
  /** Read again at every navigation, never cached: it is the browser's. */
  readonly location: {
    readonly origin: string;
    readonly pathname: string;
    readonly search: string;
  };
  readonly history: {
    pushState(data: unknown, unused: string, url: string): void;
    replaceState(data: unknown, unused: string, url: string): void;
  };
  readonly win: {
    addEventListener(type: "popstate", listener: () => void): void;
    removeEventListener(type: "popstate", listener: () => void): void;
  };
  readonly fetch: FetchLike;
  /**
   * The browser's clipboard. Absent outside a secure context, which the page
   * reads as a copy that cannot be made rather than as nothing to do.
   */
  readonly clipboard?: { writeText(text: string): Promise<void> };
  readonly setTimer: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
  readonly clock: () => number;
  readonly refreshMs?: number;
}

export interface App {
  start(): void;
  stop(): void;
  /** `false` when the load was for a route the user has since left. */
  refresh(): Promise<boolean>;
  /**
   * Ignores anything that is not a same-origin path, or the current URL.
   * `{ replace: true }` writes the address without adding to the history, which
   * is what a search box changes it for.
   */
  navigate(url: string, options?: { readonly replace?: boolean }): void;
  readonly route: Route;
}

export declare const REFRESH_MS: number;

export declare function routeOf(pathname: string): Route;

export declare function createApp(globals: AppGlobals): App;

export declare function boot(globals: AppGlobals): App;
