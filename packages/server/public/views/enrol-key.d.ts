import type { EnrolState } from "../enrol-key.js";

export interface EnrolHandlers {
  onCreate(): void;
  onVerify(): void;
}

/**
 * Draw the `/enrol-key` page from its state. `handlers.onCreate` makes a
 * passkey, `handlers.onVerify` tests the one that was made.
 */
export declare function renderEnrolKey(
  state: EnrolState,
  handlers: EnrolHandlers,
): HTMLElement;
