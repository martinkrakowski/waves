import { isProjectId } from "./ids.js";
import { type Collector, readIntegerInRange } from "./validation.js";

/** An interval of 0 seconds would make every document stale at once. */
export const MIN_INTERVAL_SECONDS = 1;

/** 300 s is the default staleness window, so no interval is wider than it. */
export const MAX_INTERVAL_SECONDS = 300;

/** The project id rule, read the same way by every document that names a project. */
export function readProjectId(
  ctx: Collector,
  value: unknown,
  path: string,
): string {
  if (typeof value !== "string") {
    ctx.add(path, "expected a project id");
    return "";
  }
  if (!isProjectId(value)) {
    ctx.add(path, "expected 1 to 63 characters of a-z, 0-9 and -");
    return "";
  }
  return value;
}

/** An interval is required as a key and `null` is its legal "use the default". */
export function readIntervalSeconds(
  ctx: Collector,
  value: unknown,
  path: string,
): number | null {
  if (value === null) {
    return null;
  }
  const seconds = readIntegerInRange(
    ctx,
    value,
    path,
    MIN_INTERVAL_SECONDS,
    MAX_INTERVAL_SECONDS,
  );
  return seconds ?? null;
}
