import { realpath, readFile } from "node:fs/promises";
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

const UNRESOLVABLE_CODES: ReadonlySet<string> = new Set([
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

function code(error: unknown): string {
  return String((error as NodeJS.ErrnoException).code);
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

/**
 * The real location of the directory the page is served from, or nothing when it
 * does not exist. Everything a request may read is compared against this path
 * rather than against the configured one, so a symbolic link inside the
 * directory cannot lead out of it.
 */
export async function realRootOf(dir: string): Promise<string | undefined> {
  try {
    return await realpath(dir);
  } catch {
    return undefined;
  }
}

/**
 * Reads a resolved file, but only once the path it really points at is still
 * under the real root, and then reads that real path, so the file that is served
 * is the file that was checked.
 */
export async function readStaticFile(
  realRoot: string,
  file: StaticFile,
): Promise<Buffer | undefined> {
  try {
    const real = await realpath(file.path);
    if (!insideRoot(realRoot, real)) {
      return undefined;
    }
    return await readFile(real);
  } catch (error) {
    if (UNRESOLVABLE_CODES.has(code(error))) {
      return undefined;
    }
    throw error;
  }
}
