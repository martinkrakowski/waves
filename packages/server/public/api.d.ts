import type {
  ProjectSummary,
  WaveSummary,
  WaveView,
} from "../src/application/read-model.js";

/**
 * A project summary as the list endpoint answers it. `Omit` keeps this
 * compiling whether or not `stale` has reached `ProjectSummary` yet; when it
 * has, the two agree and this alias can go.
 */
export type ProjectCard = Omit<ProjectSummary, "stale"> & {
  readonly stale?: boolean;
};

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
