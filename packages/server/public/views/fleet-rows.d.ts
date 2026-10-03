import type { AttentionView } from "../../src/application/read-model.js";
import type { ProjectCard } from "../api.js";

/** What a row is drawn against: the fleet's attention view and its open rows. */
export interface RowModel {
  readonly attention: AttentionView;
  /** The project ids whose row is drawn open, as the app holds them. */
  readonly open: ReadonlySet<string>;
}

/**
 * The project id a row's key names, or nothing when the node is not one of this
 * page's rows. `app.js` asks it of every `toggle` it hears.
 */
export declare function rowIdOf(node: Element): string | undefined;

/** One project's row: its head, its waves and its numbers, in the fleet's order. */
export declare function projectRow(
  project: ProjectCard,
  model: RowModel,
  nowMs: number,
): HTMLElement;
