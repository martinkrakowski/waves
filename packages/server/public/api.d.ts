import type {
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
  waves(projectId: string): Promise<readonly WaveSummary[] | undefined>;
  wave(projectId: string, waveId: string): Promise<WaveView | undefined>;
}

export declare function createApi(fetchImpl: FetchLike): Api;
