/**
 * The staleness rules live in the contract package, which the application layer
 * may not import, so the read model takes them through this port. The adapter in
 * `infrastructure/http-server.ts` forwards the contract's own functions, so
 * there is still exactly one implementation of the rules.
 */
export interface StalenessPort {
  staleAfterMs(intervalSeconds: number | null): number;
  isStale(
    lastPushMs: number,
    intervalSeconds: number | null,
    nowMs: number,
  ): boolean;
  isRetained(lastPushMs: number, nowMs: number): boolean;
}
