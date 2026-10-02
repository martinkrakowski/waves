export type Reason =
  "failed" | "disagreement" | "checks" | "gate" | "exit" | "silent";

export interface ViewQuery {
  readonly reason?: Reason;
  readonly stage?: string;
  readonly seat?: string;
  readonly q?: string;
  readonly lane?: string;
  readonly all: boolean;
}

/**
 * The parameters of a `location.search` that pass their rule. A parameter that
 * is absent, empty or malformed is not in the result; `all` is the one that is
 * always there.
 */
export declare function parseQuery(search: string): ViewQuery;

/** `""` when nothing is written, otherwise `"?…"`, in a fixed key order. */
export declare function formatQuery(query: ViewQuery): string;
