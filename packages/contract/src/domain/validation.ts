export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly ValidationIssue[] };

const MAX_ISSUES = 50;

export class IssueCollector {
  readonly issues: ValidationIssue[] = [];

  add(path: string, message: string): void {
    if (this.issues.length < MAX_ISSUES) {
      this.issues.push({ path, message });
    }
  }
}

export type Collector = IssueCollector;

export type Reader<T> = (
  ctx: Collector,
  value: unknown,
  path: string,
) => T | undefined;

const encoder = new TextEncoder();

export function byteLength(text: string): number {
  return encoder.encode(text).length;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function escapeToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

function isControlCode(code: number): boolean {
  return code < 0x20 || code === 0x7f;
}

function isLineBreakCode(code: number): boolean {
  return code === 0x09 || code === 0x0a;
}

export function hasForbiddenCharacters(
  text: string,
  allowLineBreaks: boolean,
): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (!isControlCode(code)) {
      continue;
    }
    if (allowLineBreaks && isLineBreakCode(code)) {
      continue;
    }
    return true;
  }
  return false;
}

export function isIsoUtc(text: string): boolean {
  return text.endsWith("Z") && Number.isFinite(Date.parse(text));
}

export interface StringRule {
  readonly minChars?: number;
  readonly maxChars?: number;
  readonly maxBytes?: number;
  readonly lineBreaks?: boolean;
  readonly pattern?: RegExp;
}

export function readText(
  ctx: Collector,
  value: unknown,
  path: string,
  rule: StringRule,
): string | undefined {
  if (typeof value !== "string") {
    ctx.add(path, "expected a string");
    return undefined;
  }
  if (hasForbiddenCharacters(value, rule.lineBreaks === true)) {
    ctx.add(path, "expected printable text");
    return undefined;
  }
  if (rule.minChars !== undefined && value.length < rule.minChars) {
    ctx.add(path, `expected at least ${rule.minChars} characters`);
    return undefined;
  }
  if (rule.maxChars !== undefined && value.length > rule.maxChars) {
    ctx.add(path, `expected at most ${rule.maxChars} characters`);
    return undefined;
  }
  if (rule.maxBytes !== undefined && byteLength(value) > rule.maxBytes) {
    ctx.add(path, `expected at most ${rule.maxBytes} bytes`);
    return undefined;
  }
  if (rule.pattern !== undefined && !rule.pattern.test(value)) {
    ctx.add(path, `expected to match ${rule.pattern.source}`);
    return undefined;
  }
  return value;
}

export function readTimestamp(
  ctx: Collector,
  value: unknown,
  path: string,
): string | undefined {
  const text = readText(ctx, value, path, {});
  if (text === undefined) {
    return undefined;
  }
  if (!isIsoUtc(text)) {
    ctx.add(path, "expected an ISO-8601 timestamp in UTC");
    return undefined;
  }
  return text;
}

export function readOptional<T>(
  ctx: Collector,
  value: unknown,
  path: string,
  read: Reader<T>,
): T | undefined {
  if (value === undefined) {
    return undefined;
  }
  return read(ctx, value, path);
}

export function readBoolean(
  ctx: Collector,
  value: unknown,
  path: string,
): boolean {
  if (typeof value !== "boolean") {
    ctx.add(path, "expected a boolean");
    return false;
  }
  return value;
}

export function readEnum<T extends string>(
  ctx: Collector,
  value: unknown,
  path: string,
  allowed: readonly T[],
): T | undefined {
  const options: readonly string[] = allowed;
  if (typeof value !== "string" || !options.includes(value)) {
    ctx.add(path, `expected one of ${options.join(", ")}`);
    return undefined;
  }
  return value as T;
}

export function readInteger(
  ctx: Collector,
  value: unknown,
  path: string,
): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    ctx.add(path, "expected an integer");
    return undefined;
  }
  return value;
}

export function readIntegerAtLeast(
  ctx: Collector,
  value: unknown,
  path: string,
  min: number,
): number | undefined {
  const integer = readInteger(ctx, value, path);
  if (integer === undefined) {
    return undefined;
  }
  if (integer < min) {
    ctx.add(path, `expected an integer >= ${min}`);
    return undefined;
  }
  return integer;
}

export function readIntegerInRange(
  ctx: Collector,
  value: unknown,
  path: string,
  min: number,
  max: number,
): number | undefined {
  const integer = readIntegerAtLeast(ctx, value, path, min);
  if (integer === undefined) {
    return undefined;
  }
  if (integer > max) {
    ctx.add(path, `expected an integer <= ${max}`);
    return undefined;
  }
  return integer;
}

export function readNumberAtLeast(
  ctx: Collector,
  value: unknown,
  path: string,
  min: number,
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    ctx.add(path, "expected a finite number");
    return undefined;
  }
  if (value < min) {
    ctx.add(path, `expected a number >= ${min}`);
    return undefined;
  }
  return value;
}

export function readNumberInRange(
  ctx: Collector,
  value: unknown,
  path: string,
  min: number,
  max: number,
): number | undefined {
  const number = readNumberAtLeast(ctx, value, path, min);
  if (number === undefined) {
    return undefined;
  }
  if (number > max) {
    ctx.add(path, `expected a number <= ${max}`);
    return undefined;
  }
  return number;
}

export function readClosedObject(
  ctx: Collector,
  value: unknown,
  path: string,
  keys: readonly string[],
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    ctx.add(path, "expected an object");
    return undefined;
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) {
      ctx.add(`${path}/${escapeToken(key)}`, "unknown key");
    }
  }
  return value;
}
