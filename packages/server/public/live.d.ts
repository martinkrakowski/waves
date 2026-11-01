/**
 * Mounts the next rendered `.app` frame into `root`, keeping connected
 * `[role="status"]` live regions in place across redraws while replacing
 * controls and non-live subtrees around them.
 */
export declare function mountFrame(
  root: HTMLElement,
  nextApp: HTMLElement,
): void;
