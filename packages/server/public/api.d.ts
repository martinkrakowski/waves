import type {
  InboxView,
  DecisionView,
} from "../src/application/notice-read-model.js";
import type {
  AttentionView,
  ProjectLanesView,
  ProjectSummary,
  StatusView,
  WaveView,
} from "../src/application/read-model.js";

/**
 * A project summary as the project list endpoint answers it. The read model is
 * the only authority on that shape, so this is an alias and nothing else.
 */
export type ProjectCard = ProjectSummary;

export interface ApiResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type FetchLike = (
  path: string,
  init?: { readonly headers?: Readonly<Record<string, string>> },
) => Promise<ApiResponse>;

export interface Api {
  projects(): Promise<readonly ProjectCard[]>;
  /**
   * What every project's lanes asked for at once. `undefined` for a 404, which
   * the app reads as a failed load: the route is not optional.
   */
  attention(): Promise<AttentionView | undefined>;
  /**
   * What every project is asking the owner to decide, with the counts that
   * name their sources. One entry per registered project, in registry order.
   */
  inbox(): Promise<InboxView>;
  /**
   * Every lane of every wave of one project, with the wave heads the page draws
   * the wave strip from. `all` asks for the waves past the retention as well.
   */
  lanes(projectId: string, all: boolean): Promise<ProjectLanesView | undefined>;
  /**
   * One wave on its own. Nothing on the page asks for it; lane K6's drawer does,
   * and its direct test is what keeps this one honest until then.
   */
  wave(projectId: string, waveId: string): Promise<WaveView | undefined>;
  /**
   * What one project last said about itself: the pull-request rows its last
   * listing could not read, and what its last `plan:verify` artifact said.
   * `undefined` for a 404, which is the answer for a project that has pushed
   * none rather than a failed load — the panel is optional where the other reads
   * are not.
   */
  status(projectId: string): Promise<StatusView | undefined>;
  /**
   * One decision's whole record, or `undefined` for a 404. A 404 is a failed
   * load: the route is not optional, and a decision the page cannot draw is one
   * the app treats as offline rather than as a page that was right.
   */
  decision(
    projectId: string,
    decisionId: string,
  ): Promise<DecisionView | undefined>;
}

export declare function createApi(fetchImpl: FetchLike): Api;
