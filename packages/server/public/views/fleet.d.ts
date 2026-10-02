import type { AttentionView } from "../../src/application/read-model.js";
import type { ProjectCard } from "../api.js";

export interface FleetModel {
  readonly projects: readonly ProjectCard[];
  readonly attention: AttentionView;
}

export declare function renderFleet(
  model: FleetModel,
  nowMs: number,
): HTMLElement;
