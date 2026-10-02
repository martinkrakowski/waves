import type { WaveSummary, WaveView } from "../src/application/read-model.js";

export interface WavePanelModel {
  readonly project: string;
  readonly waves: readonly WaveSummary[];
  readonly showAll: boolean;
  readonly selected: string;
  readonly view: WaveView | undefined;
}

export interface WavePanelHandlers {
  onSelect(waveId: string): void;
  onToggleAll(): void;
}

export declare function drawableWaves(
  waves: unknown,
): waves is readonly WaveSummary[];

export declare function visibleWaves(
  waves: readonly WaveSummary[],
  showAll: boolean,
): readonly WaveSummary[];

export declare function wavePanel(
  model: WavePanelModel,
  nowMs: number,
  handlers: WavePanelHandlers,
): HTMLElement;
