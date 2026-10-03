/** The three tabs the fleet page is divided into, in the order it offers them. */
export type FleetTab = "active" | "flagged" | "quiet";

export type Reason =
  "failed" | "disagreement" | "checks" | "gate" | "exit" | "silent";

export interface ViewQuery {
  /**
   * The fleet's own filter. Absent means every project, and the app drops it on
   * any other route, so a project page's links can never carry it.
   */
  readonly tab?: FleetTab;
  readonly reason?: Reason;
  readonly stage?: string;
  readonly seat?: string;
  readonly q?: string;
  readonly lane?: string;
  readonly all: boolean;
}

/** The tab names themselves, so a view and the parser agree on the list. */
export declare const TABS: readonly FleetTab[];

/**
 * The parameters of a `location.search` that pass their rule. A parameter that
 * is absent, empty or malformed is not in the result; `all` is the one that is
 * always there.
 */
export declare function parseQuery(search: string): ViewQuery;

/** `""` when nothing is written, otherwise `"?…"`, in a fixed key order. */
export declare function formatQuery(query: ViewQuery): string;
