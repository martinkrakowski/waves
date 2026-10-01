const MAX_STALE_SECONDS = 300;
const DEFAULT_STALE_MS = 300_000;
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export function staleAfterMs(intervalSeconds: number | null): number {
  if (intervalSeconds === null) {
    return DEFAULT_STALE_MS;
  }
  return Math.min(3 * intervalSeconds, MAX_STALE_SECONDS) * 1000;
}

export function isStale(
  lastPushMs: number,
  intervalSeconds: number | null,
  nowMs: number,
): boolean {
  return nowMs - lastPushMs > staleAfterMs(intervalSeconds);
}

export function isRetained(lastPushMs: number, nowMs: number): boolean {
  return nowMs - lastPushMs <= RETENTION_MS;
}
