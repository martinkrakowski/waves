import type { ProjectCard } from "../api.js";

export interface FleetModel {
  readonly projects: readonly ProjectCard[];
}

export declare function renderFleet(
  model: FleetModel,
  nowMs: number,
): HTMLElement;
