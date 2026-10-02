import type {
  LaneRow,
  ProjectLanesView,
  WaveSummary,
} from "../../src/application/read-model.js";
import type { ViewQuery } from "../query.js";

export interface ProjectModel {
  readonly lanes: ProjectLanesView;
  /** The wave the path names, or undefined on the project's own page. */
  readonly wave: string | undefined;
  readonly query: ViewQuery;
}

/** The rows a route shows: every row, or the rows of the wave it names. */
export declare function scopeOf(
  view: ProjectLanesView,
  wave: string | undefined,
): readonly LaneRow[];

/** `/p/<id>` or `/p/<id>/w/<wave>`, each segment encoded. */
export declare function pathFor(
  projectId: string,
  wave: string | undefined,
): string;

/** The path plus the reader's own query, so a filter survives a choice. */
export declare function hrefFor(
  projectId: string,
  wave: string | undefined,
  query: ViewQuery,
): string;

/** Reasons first, then the newest wave, then the lane id. */
export declare function sortRows(
  rows: readonly LaneRow[],
  waves: readonly WaveSummary[],
): readonly LaneRow[];

export declare function renderProject(
  model: ProjectModel,
  nowMs: number,
): HTMLElement;
