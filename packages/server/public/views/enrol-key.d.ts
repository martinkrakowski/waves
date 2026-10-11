import type { EnrolState } from "../enrol-key.js";

export interface EnrolHandlers {
  onCreate(): void;
  /** The second create button: the key is made on a hardware security key. */
  onCreateRoaming(): void;
  onVerify(): void;
}

/**
 * Draw the `/enrol-key` page from its state. `handlers.onCreate` makes a
 * passkey on this device, `handlers.onCreateRoaming` one on a hardware
 * security key, and `handlers.onVerify` tests the one that was made.
 */
export declare function renderEnrolKey(
  state: EnrolState,
  handlers: EnrolHandlers,
): HTMLElement;
