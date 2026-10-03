import type { BacklogState } from "@hexagen-monaco/waves-contract";
import type { StatusView } from "../src/application/read-model.js";

/**
 * The one response `GET /api/v1/projects/<id>/status` answers, and the shape the
 * status panel draws from. The read model is the only authority on it, so this
 * is a re-export and nothing else.
 */
export type Status = StatusView;

/**
 * The `status` of a project summary: the two facts a fleet card shows, and never
 * a `0` for a field the summary did not send.
 */
export interface StatusFacts {
  readonly receivedAt: string;
  readonly stale: boolean;
  readonly prsSkipped?: number;
  readonly backlogState?: BacklogState;
}

/** Whether a response is a project status the panel can draw at all. */
export declare function drawableStatus(view: unknown): boolean;

/** Whether a project summary's `status` is the two facts a card can show. */
export declare function drawableStatusFacts(value: unknown): boolean;
