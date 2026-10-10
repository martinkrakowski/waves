import type { Head } from "../../src/application/notice-read-model.js";
import type { StoredEvent } from "../../src/application/ports/notice-store.js";

/**
 * The history block: a collapsed `<details>` holding one line per history head,
 * newest `at` first. Returns `undefined` when there are no history heads, so
 * the caller can push the return value and filter it like the group blocks.
 */
export declare function historyHeads(
  heads: readonly Head[],
  project: string,
): HTMLElement | undefined;

/**
 * The events section: always drawn, under the "Events" heading. Empty shows
 * "No events."; otherwise one element per event in the order given, each
 * holding its own detail and refs beneath it, and a cap notice when exactly
 * 200 are shown.
 */
export declare function eventsList(
  events: readonly StoredEvent[],
  project: string,
): HTMLElement;
