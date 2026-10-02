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

export interface LinkAttrs {
  readonly [name: string]: string;
}

/**
 * `attrs` is spelled out by the caller and is refused unless every name is in
 * `dom.js`'s table, so a view cannot reach an attribute the table does not
 * allow.
 */
export declare function internalLink(
  label: string,
  path: string,
  attrs?: LinkAttrs,
): HTMLElement;

export declare function repoLink(label: string, value: unknown): HTMLElement;
