import type { AttentionView } from "../../src/application/read-model.js";
import type { ProjectCard } from "../api.js";
import type { FleetTab } from "../query.js";

/** What one project is asking for, or nothing: the view has no entry for it. */
export declare function attentionOf(
  attention: AttentionView,
  projectId: string,
): number;

/**
 * Which tab one project is in: a failed newest wave or a lane asking is
 * `flagged`, a running wave is `active`, and the rest are `quiet`.
 */
export declare function tabOf(
  project: ProjectCard,
  attention: AttentionView,
): FleetTab;

/** How many projects each tab holds, over the whole fleet and before a search. */
export declare function tabCounts(
  projects: readonly ProjectCard[],
  attention: AttentionView,
): Record<"all" | FleetTab, number>;

/**
 * Whether one project is what the reader's own search is looking for: a
 * case-insensitive substring of its name, its id or its repository.
 */
export declare function matches(
  project: ProjectCard,
  needle: string | undefined,
): boolean;

/** The two numbers a row's ring is drawn from, over the waves that row lists. */
export declare function ringOf(project: ProjectCard): {
  readonly lanes: number;
  readonly merged: number;
};

/** The seven numbers the hero's line and the four stat cards break down. */
export declare function totals(
  projects: readonly ProjectCard[],
  attention: AttentionView,
): {
  readonly projects: number;
  readonly running: number;
  readonly recent: number;
  readonly lanes: number;
  readonly merged: number;
  readonly asking: number;
  readonly stale: number;
};

/**
 * Which of the twelve phase classes an ambient animation is drawn at, over that
 * animation's own period. `fleet.css` holds the delays those classes carry.
 */
export declare function phaseOf(nowMs: number, periodMs: number): string;
