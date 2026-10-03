import type { ProjectCard } from "../api.js";
import type { ViewQuery } from "../query.js";
import type { RowModel } from "./fleet-rows.js";

/** What the fleet page is drawn from, all of it already past its shape check. */
export interface FleetModel extends RowModel {
  readonly projects: readonly ProjectCard[];
  /** The reader's own filter and search, as the address holds them. */
  readonly query: ViewQuery;
}

/** What the fleet page asks the app for: one search box, and nothing else. */
export interface FleetHandlers {
  onSearch(text: string): void;
}

export declare function renderFleet(
  model: FleetModel,
  nowMs: number,
  handlers: FleetHandlers,
): HTMLElement;
