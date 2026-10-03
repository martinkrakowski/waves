import { readProjectId } from "./fields.js";
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

/**
 * The characters RFC 3986 lets a URL carry without escaping: the unreserved
 * characters, the gen-delimiters, the sub-delimiters, and `%`. Written without control-character escapes, so
 * `no-control-regex` stays happy.
 *
 * Three things are known and accepted. A bare `%` is one of the set, so `b%ZZ`
 * and a trailing `%` pass this rule, and `new URL` accepts them too, so both
 * are stored. IPv6
 * brackets are delimiters, so `https://[2001:db8::1]/a` passes. An
 * internationalised host is refused, because its letters are not ASCII and a
 * URL has to spell them as punycode or as percent escapes.
 */
const REPO_CHARACTER_PATTERN = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]*$/;

/** The parsed URL, or `undefined` for a string `new URL` will not read at all. */
function parseUrl(text: string): URL | undefined {
  try {
    return new URL(text);
  } catch {
    return undefined;
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
  if (!REPO_CHARACTER_PATTERN.test(url)) {
    ctx.add(path, "expected only the characters a URL holds unescaped");
    return undefined;
  }
  const parsed = parseUrl(url);
  if (parsed === undefined || parsed.protocol !== "https:") {
    ctx.add(path, "expected an https URL");
    return undefined;
  }
  // A stored `repo` is a link every viewer of a project can follow, so a
  // credential in one would be published with it. `URL` keeps the authority
  // before the first `/`, so a `:` or an `@` in the path is not a credential
  // and `https://github.com/a:b@c` is still stored.
  if (parsed.username !== "" || parsed.password !== "") {
    ctx.add(path, "expected no user or password in the URL");
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
