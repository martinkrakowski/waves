import type { WaveView } from "../../src/application/read-model.js";

export interface DrawerModel {
  /** What the app has managed to read so far. Only `ready` carries a view. */
  readonly state: "loading" | "failed" | "gone" | "missing" | "ready";
  /** The route's project id. */
  readonly project: string;
  /** The project's registered repo, from the lanes listing, when it has one. */
  readonly repo?: string;
  /** The route's wave id. */
  readonly wave: string;
  /** The query's lane id. */
  readonly lane: string;
  /** The listing row's reasons, `[]` when the listing holds no such row. */
  readonly reasons: readonly string[];
  /** The wave the detail route answered with, once it has answered. */
  readonly view?: WaveView;
}

export interface DrawerHandlers {
  /** The reader asked to close the drawer. */
  onClose(): void;
}

/**
 * The address of a pull request on the project's repository, or `undefined`.
 * `undefined` unless the repository is an `https:` URL on `github.com` with
 * exactly two path segments in GitHub's own alphabet and no `.git` suffix, and
 * the number is a positive safe integer. `number` is `unknown` because it is
 * checked: a shape check that could not fail would not be one.
 */
export declare function prUrl(
  repo: string | undefined,
  number: unknown,
): string | undefined;

/**
 * One lane's whole drawer: what the service holds about it, beside what it
 * derived. Returns the single `.drawer` element the app puts in the dialog.
 */
export declare function renderDrawer(
  model: DrawerModel,
  nowMs: number,
  handlers: DrawerHandlers,
): HTMLElement;
