import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

export const HTML_TYPE = "text/html; charset=utf-8";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": HTML_TYPE,
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/vnd.microsoft.icon",
  ".json": "application/json; charset=utf-8",
};

const ENCODED_SLASH = /%2f/i;

const UNREADABLE_CODES: ReadonlySet<string> = new Set([
  "ENOENT",
  "ENOTDIR",
  "EISDIR",
  "ELOOP",
]);

export interface StaticFile {
  readonly path: string;
  readonly type: string;
}

export function contentTypeFor(name: string): string | undefined {
  return CONTENT_TYPES[extname(name).toLowerCase()];
}

function decodeOnce(pathname: string): string | undefined {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
}

function insideRoot(root: string, target: string): boolean {
  return target.startsWith(root + sep);
}

/**
 * Resolves one request path to one file under `root`, or to nothing. The path is
 * decoded once and refused outright when it carries an encoded slash, a
 * backslash, a NUL or a dot segment, then checked a second time by requiring
 * the resolved absolute path to stay under `root`. Only the allow-listed
 * extensions resolve, so a directory never becomes a readable file.
 */
export function resolveStaticFile(
  root: string,
  pathname: string,
): StaticFile | undefined {
  if (ENCODED_SLASH.test(pathname)) {
    return undefined;
  }
  const decoded = decodeOnce(pathname);
  if (decoded === undefined) {
    return undefined;
  }
  const name = decoded.replace(/^\//, "");
  if (name.includes("..") || name.includes("\\") || name.includes("\0")) {
    return undefined;
  }
  const target = resolve(root, name);
  if (!insideRoot(root, target)) {
    return undefined;
  }
  const type = contentTypeFor(target);
  if (type === undefined) {
    return undefined;
  }
  return { path: target, type };
}

function unreadable(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return UNREADABLE_CODES.has(String(code));
}

export async function readStaticFile(
  file: StaticFile,
): Promise<Buffer | undefined> {
  try {
    return await readFile(file.path);
  } catch (error) {
    if (unreadable(error)) {
      return undefined;
    }
    throw error;
  }
}
