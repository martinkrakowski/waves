import type { FetchLike } from "./api.js";

export type Route =
  | { readonly kind: "projects" }
  | { readonly kind: "project"; readonly id: string }
  | { readonly kind: "unknown" };

export interface AppGlobals {
  readonly doc: Document;
  readonly location: { readonly pathname: string };
  readonly fetch: FetchLike;
  readonly setTimer: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
  readonly clock: () => number;
  readonly refreshMs?: number;
}

export interface App {
  start(): void;
  stop(): void;
  /** `false` when the load was for a wave the user has since left. */
  refresh(): Promise<boolean>;
  readonly route: Route;
}

export declare const REFRESH_MS: number;

export declare function routeOf(pathname: string): Route;

export declare function createApp(globals: AppGlobals): App;

export declare function boot(globals: AppGlobals): App;
