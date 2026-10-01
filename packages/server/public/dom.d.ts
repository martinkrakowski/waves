export interface UiOptions {
  readonly text?: string;
  readonly attrs?: Readonly<Record<string, string>>;
  readonly children?: readonly Node[];
}

export declare function el(tag: string, options?: UiOptions): HTMLElement;

export declare function text(value: unknown): HTMLElement;

export declare function stamp(
  iso: string | undefined,
  nowMs: number,
): HTMLElement;

export declare function httpsUrl(value: unknown): string | undefined;

export declare function internalLink(label: string, path: string): HTMLElement;

export declare function repoLink(label: string, value: unknown): HTMLElement;
