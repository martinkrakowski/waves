import type { NonceSource } from "./ports/nonce-source.js";
import type { Now } from "./read-model.js";

/** How long a nonce lives, counted by the injected clock from its issue. */
export const NONCE_TTL_MS = 120_000;

/** The most nonces the store holds alive at once, across every decision. */
export const MAX_NONCES = 64;

/** The most nonces the store holds alive at once for one decision. */
export const MAX_NONCES_PER_DECISION = 4;

interface HeldNonce {
  readonly project: string;
  readonly decision: string;
  readonly issuedAt: number;
}

export interface NonceStore {
  /**
   * Mints a nonce for one decision and answers its value. A cap never refuses
   * an issue: room is made by dropping the oldest nonce first, so nobody can
   * lock the owner out by asking.
   */
  issue(project: string, decision: string): string;
  /**
   * Spends a nonce. It is removed whether or not it has expired, and true is
   * answered only when it was alive and issued for exactly this project and
   * decision.
   */
  consume(project: string, decision: string, nonce: string): boolean;
}

/**
 * The nonces this service has minted and not yet spent, held in memory for the
 * life of the process: a nonce lives two minutes and is consumed by the very
 * request that answers the decision, so a restart loses nothing that was
 * still usable, and a file would only add a write to refuse later.
 *
 * The clock and the source of the nonce bytes are injected, so this layer has
 * no `Date` and no randomness of its own.
 */
export function createNonceStore(deps: {
  now: Now;
  source: NonceSource;
}): NonceStore {
  const { now, source } = deps;

  /**
   * The live nonces, keyed by the nonce itself, in the order they were issued.
   * A `Map` iterates in insertion order, nothing is ever re-inserted, and an
   * expired nonce is only ever removed — never refreshed — so the first key is
   * always the first nonce this store issued, whatever the clock has done
   * since.
   */
  const held = new Map<string, HeldNonce>();

  const expired = (entry: HeldNonce, at: number): boolean =>
    at - entry.issuedAt >= NONCE_TTL_MS;

  /**
   * Drops the first nonce in issue order — the oldest, whether or not it is
   * the soonest to expire — for one decision when a decision is given, or for
   * the whole store when it is not.
   */
  const dropOldest = (project?: string, decision?: string): void => {
    for (const [nonce, entry] of held) {
      if (
        project === undefined ||
        (entry.project === project && entry.decision === decision)
      ) {
        held.delete(nonce);
        return;
      }
    }
  };

  return {
    issue(project, decision) {
      const at = now();
      // Expired nonces are removed on every issue, before the caps are
      // applied, so a cap counts only the nonces that are still live and never
      // drops a live one to make room for one that has already gone.
      for (const [nonce, entry] of held) {
        if (expired(entry, at)) {
          held.delete(nonce);
        }
      }
      let forDecision = 0;
      for (const entry of held.values()) {
        if (entry.project === project && entry.decision === decision) {
          forDecision += 1;
        }
      }
      if (forDecision === MAX_NONCES_PER_DECISION) {
        dropOldest(project, decision);
      }
      while (held.size >= MAX_NONCES) {
        dropOldest();
      }
      const nonce = source();
      held.set(nonce, { project, decision, issuedAt: at });
      return nonce;
    },

    consume(project, decision, nonce) {
      const entry = held.get(nonce);
      // Removed whether or not the attempt matches and whether or not the
      // nonce has expired: a nonce answers one attempt, and the boolean says
      // whether that attempt was the owner's.
      held.delete(nonce);
      return (
        entry !== undefined &&
        entry.project === project &&
        entry.decision === decision &&
        now() - entry.issuedAt < NONCE_TTL_MS
      );
    },
  };
}
