/**
 * The two questions every rule in this package asks about a value that arrived
 * from JSON: is it an object, and does it carry this key? Answering them once
 * here keeps the checks identical everywhere and keeps `Object.hasOwn` out of
 * the rest of the domain.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function own(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
