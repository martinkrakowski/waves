import type {
  AttentionView,
  ProjectLanesView,
  ProjectSummary,
  WaveSummary,
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
   * Every lane of every wave of one project, with the wave heads the page draws
   * the wave strip from. `all` asks for the waves past the retention as well.
   */
  lanes(projectId: string, all: boolean): Promise<ProjectLanesView | undefined>;
  waves(projectId: string): Promise<readonly WaveSummary[] | undefined>;
  wave(projectId: string, waveId: string): Promise<WaveView | undefined>;
}

export declare function createApi(fetchImpl: FetchLike): Api;
