import type {
  ProjectSummary,
  WaveSummary,
  WaveView,
} from "../src/application/read-model.js";

/**
 * A project summary plus the one flag the project list badges on. The read
 * model does not send it yet: `isStale` needs the interval, which
 * `ProjectSummary` does not carry. It is optional here so the list stays
 * correct either way.
 */
export interface ProjectCard extends ProjectSummary {
  readonly stale?: boolean;
}

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
