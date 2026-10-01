import type { LaneView, WaveView } from "../src/application/read-model.js";

export declare function drawableLanes(view: WaveView): readonly LaneView[];

export declare function laneTable(view: WaveView, nowMs: number): HTMLElement;
