import type { WaveSummary, WaveView } from "../src/application/read-model.js";

export declare function drawableWaves(
  waves: unknown,
): waves is readonly WaveSummary[];

export declare function drawableWave(view: unknown): view is WaveView;

export declare function visibleWaves(
  waves: readonly WaveSummary[],
  showAll: boolean,
): readonly WaveSummary[];
