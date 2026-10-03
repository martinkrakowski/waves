import type {
  LaneRow,
  ProjectLanesView,
  WaveSummary,
} from "../../src/application/read-model.js";
import type { ViewQuery } from "../query.js";
import type { Status } from "../status.js";

export interface ProjectModel {
  readonly lanes: ProjectLanesView;
  /** The wave the path names, or undefined on the project's own page. */
  readonly wave: string | undefined;
  readonly query: ViewQuery;
  /**
   * What the project last said about itself, or undefined when it has pushed no
   * status: the panel is drawn for a status and is not drawn at all without one.
   */
  readonly status?: Status;
  /** What the last copy of the digest said, or nothing when it said nothing. */
  readonly copied?: string;
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

export interface Counters {
  readonly lanes: number;
  readonly alive: number;
  readonly unknown: number;
  readonly attention: number;
  readonly disagreements: number;
  readonly openPrs: number;
}

export interface SeatCount {
  /** Absent for the rows that recorded no seat. */
  readonly seat: string | undefined;
  readonly lanes: number;
}

export interface StageCount {
  /** Absent for the rows that reported nothing. */
  readonly stage: string | undefined;
  readonly lanes: number;
}

/** The six numbers the page leads with, over the rows in scope. */
export declare function countersOf(rows: readonly LaneRow[]): Counters;

/** The seats in scope, busiest first, with no seat last. */
export declare function seatsOf(rows: readonly LaneRow[]): readonly SeatCount[];

/** The stages in scope in the order they are first reported, none reported last. */
export declare function stagesOf(
  rows: readonly LaneRow[],
): readonly StageCount[];

/** The stale wave heads in scope: the route's own wave, or the shown waves. */
export declare function staleWavesOf(
  view: ProjectLanesView,
  wave: string | undefined,
  all: boolean,
): readonly WaveSummary[];

/** The four states one wave's lanes derive, in the order the plan's W35 has. */
export type WaveState = "failed" | "done" | "running" | "settled";

/**
 * The state of one wave from the rows the listing holds for it and the head's
 * own staleness, in W35's order.
 */
export declare function waveStateOf(
  rows: readonly LaneRow[],
  stale: boolean,
): WaveState;

/** Whether a row is one the reader's own filter is looking for. */
export declare function matches(row: LaneRow, query: ViewQuery): boolean;

/** The rows a reader's filter leaves, in the order they were given. */
export declare function filterRows(
  rows: readonly LaneRow[],
  query: ViewQuery,
): readonly LaneRow[];

/**
 * How many rows carry each of the six reasons, in the order `attention.js`
 * writes them. Every reason is answered, including the ones no row carries.
 */
export declare function reasonCounts(
  rows: readonly LaneRow[],
): ReadonlyMap<string, number>;

/**
 * What a search box may put in the address: the first 80 characters, with every
 * control character taken out.
 */
export declare function searchText(value: string): string;

export interface ProjectHandlers {
  /** A filter was chosen from a select. `undefined` clears that filter. */
  onFilter(patch: {
    readonly seat?: string | undefined;
    readonly stage?: string | undefined;
  }): void;
  /** The search text changed. `""` clears it. */
  onSearch(text: string): void;
  /** Copy the digest of the rows on screen. */
  onCopy(): void;
}

/** Reasons first, then the newest wave, then the lane id. */
export declare function sortRows(
  rows: readonly LaneRow[],
  waves: readonly WaveSummary[],
): readonly LaneRow[];

export declare function renderProject(
  model: ProjectModel,
  nowMs: number,
  handlers: ProjectHandlers,
): HTMLElement;
