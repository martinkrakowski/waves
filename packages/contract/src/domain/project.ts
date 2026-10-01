import { isProjectId } from "./ids.js";
import type { Project } from "./model.js";
import {
  type Collector,
  type StringRule,
  type ValidationResult,
  IssueCollector,
  normalise,
  own,
  readClosedObject,
  readOptional,
  readText,
  readTimestamp,
} from "./validation.js";

const PROJECT_KEYS = ["id", "name", "repo", "tokenSha256", "registeredAt"];
const MAX_NAME_CHARS = 80;
const MAX_REPO_CHARS = 200;
const NAME_RULE: StringRule = { minChars: 1, maxChars: MAX_NAME_CHARS };
const REPO_RULE: StringRule = { maxChars: MAX_REPO_CHARS };
const TOKEN_RULE: StringRule = { pattern: /^[0-9a-f]{64}$/ };

function readProjectId(ctx: Collector, value: unknown, path: string): string {
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

function isHttpsUrl(text: string): boolean {
  try {
    return new URL(text).protocol === "https:";
  } catch {
    return false;
  }
}

function readRepo(
  ctx: Collector,
  value: unknown,
  path: string,
): string | undefined {
  const url = readText(ctx, value, path, REPO_RULE);
  if (url === undefined) {
    return undefined;
  }
  if (!isHttpsUrl(url)) {
    ctx.add(path, "expected an https URL");
    return undefined;
  }
  return url;
}

function readProject(ctx: Collector, input: unknown): Project | undefined {
  const record = readClosedObject(ctx, input, "", PROJECT_KEYS);
  if (record === undefined) {
    return undefined;
  }
  const id = readProjectId(ctx, own(record, "id"), "/id");
  const name = readText(ctx, own(record, "name"), "/name", NAME_RULE) ?? "";
  const repo = readOptional(ctx, own(record, "repo"), "/repo", readRepo);
  const tokenSha256 =
    readText(ctx, own(record, "tokenSha256"), "/tokenSha256", TOKEN_RULE) ?? "";
  const registeredAt =
    readTimestamp(ctx, own(record, "registeredAt"), "/registeredAt") ?? "";
  if (ctx.issues.length > 0) {
    return undefined;
  }
  return { id, name, repo, tokenSha256, registeredAt };
}

export function validateProject(input: unknown): ValidationResult<Project> {
  const normalised = normalise(input, "project");
  if (!normalised.ok) {
    return { ok: false, errors: normalised.errors };
  }
  const ctx = new IssueCollector();
  const value = readProject(ctx, normalised.value);
  if (value === undefined) {
    return { ok: false, errors: ctx.issues };
  }
  return { ok: true, value };
}
