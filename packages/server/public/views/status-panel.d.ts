import type { Status } from "../status.js";

/**
 * The whole panel for one project's status, which the app has already held to
 * `drawableStatus`. Nothing is drawn at all when the project pushed no status —
 * that decision belongs to the page, not to this view.
 */
export declare function renderStatusPanel(
  view: Status,
  nowMs: number,
): HTMLElement;

/**
 * The badge class each of the four premise statuses gets. The panel chooses from
 * this table and never builds a class from a status value.
 */
export declare const PREMISE_CLASS: Readonly<Record<string, string>>;
