import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Project, StoredSnapshot } from "@hexagen-monaco/waves-contract";

import type { DigestComparer } from "../src/application/bearer.js";
import type { StorePort } from "../src/application/ports/store.js";
import { createHttpServer } from "../src/infrastructure/http-server.js";
import { MemoryStore } from "../src/infrastructure/memory-store.js";

export const NOW_MS = Date.parse("2026-10-01T12:01:00Z");

const INDEX_HTML = "<!doctype html><title>waves</title>\n";
const APP_JS = '"use strict";\n';
const APP_CSS = "body { color: black; }\n";
const OUTSIDE_PACKAGE = '{ "name": "not-public" }\n';
const CANARY = "canary-outside-the-public-directory\n";

export interface HarnessOptions {
  readonly store?: StorePort<Project, StoredSnapshot>;
  readonly readToken?: string;
  readonly adminToken?: string;
  readonly trustProxy?: boolean;
  readonly compare?: DigestComparer;
  readonly mint?: () => string;
  readonly now?: () => number;
  readonly publicDir?: string;
}

export interface Started {
  readonly origin: string;
  readonly port: number;
  readonly logLines: () => string[];
  readonly raw: (
    requestLine: string,
    headers?: readonly string[],
    body?: string | Buffer,
  ) => Promise<string>;
  /**
   * Sends headers that ask the server to hold the body until it answers, and
   * reports what came back and how much of the body went out. `undici` cannot
   * send `Expect`, so this is a socket.
   */
  readonly expecting: (
    requestLine: string,
    headers: readonly string[],
    body: string | Buffer,
    options?: { readonly waitForContinue?: boolean },
  ) => Promise<{
    status: string;
    sent: number;
    body: string;
    reset: boolean;
  }>;
  /**
   * Sends the head and nothing else, then reports what the server answered and
   * whether the body that follows went anywhere. A client that finds out from
   * the refusal is what keeps a refused body from being read.
   */
  readonly headOnly: (
    requestLine: string,
    headers: readonly string[],
    body: string | Buffer,
  ) => Promise<{
    status: string;
    read: number;
    written: number;
    failed: boolean;
  }>;
  /**
   * The bytes the server has taken off its own sockets, which is how a test
   * shows that a request body was never read rather than merely refused.
   */
  readonly bytesRead: () => number;
  /**
   * The server-side sockets as they are now, so a test can watch one being ended
   * and then dropped without waiting on a client to notice.
   */
  readonly sockets: () => readonly {
    readonly destroyed: boolean;
    readonly writableEnded: boolean;
  }[];
  readonly stop: () => Promise<void>;
}

/** Every status line in a raw response, so `100` and the final answer differ. */
export function statusLines(raw: string): string[] {
  return [...raw.matchAll(/^HTTP\/1\.1 (\d{3})(?: .*)?$/gm)].map(
    (match) => `HTTP/1.1 ${String(match[1])}`,
  );
}

/** The status of the last answer in a raw response, exactly as it was written. */
export function finalStatus(raw: string): string {
  const lines = statusLines(raw);
  return lines[lines.length - 1] ?? "";
}

const cleanups: (() => Promise<void>)[] = [];

/**
 * Every log line every harness in this file has written, and every secret any
 * test in this file used. A test at the end of each file asserts that none of
 * the lines carries one of the secrets, which is the only way to show that no
 * log statement anywhere echoes a token, a header or a body.
 */
const allLines: string[] = [];
const secrets = new Set<string>();

export function watchSecret(secret: string): void {
  secrets.add(secret);
}

export function logLeaks(): string[] {
  const written = allLines.join("\n");
  return [...secrets].filter((secret) => written.includes(secret));
}

export async function cleanupHarnesses(): Promise<void> {
  await Promise.all(cleanups.splice(0).map((clean) => clean()));
}

async function publicDir(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "waves-http-"));
  cleanups.push(async () => {
    await rm(parent, { recursive: true, force: true });
  });
  const root = join(parent, "public");
  await mkdir(join(root, "dir.js"), { recursive: true });
  await writeFile(join(root, "index.html"), INDEX_HTML, "utf8");
  await writeFile(join(root, "app.js"), APP_JS, "utf8");
  await writeFile(join(root, "app.css"), APP_CSS, "utf8");
  await writeFile(join(parent, "package.json"), OUTSIDE_PACKAGE, "utf8");
  const canary = join(parent, "canary.json");
  await writeFile(canary, CANARY, "utf8");
  await symlink(canary, join(root, "escape.json"));
  await symlink(join(root, "app.js"), join(root, "inside.js"));
  return root;
}

async function rawRequest(
  port: number,
  requestLine: string,
  headers: readonly string[],
  body: string | Buffer = "",
): Promise<string> {
  const socket = connect(port, "127.0.0.1");
  socket.setEncoding("utf8");
  const chunks: string[] = [];
  socket.on("data", (chunk: string) => chunks.push(chunk));
  await new Promise<void>((ready) => {
    socket.on("connect", () => ready());
  });
  const head = [
    requestLine,
    "Host: localhost",
    ...headers,
    "Connection: close",
    "",
    "",
  ].join("\r\n");
  socket.write(
    Buffer.concat([
      Buffer.from(head, "utf8"),
      Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8"),
    ]),
  );
  await new Promise<void>((ended) => {
    socket.on("close", () => ended());
  });
  socket.destroy();
  return chunks.join("");
}

/**
 * A client that honours `Expect: 100-continue`: it sends the head, waits for
 * the answer, and only then the body. `sent` is the number of body bytes that
 * went out, which is what tells a refused request that refused before the body
 * from one that asked for it.
 */
async function expectingRequest(
  port: number,
  requestLine: string,
  headers: readonly string[],
  body: string | Buffer,
  waitForContinue = true,
): Promise<{
  status: string;
  sent: number;
  body: string;
  reset: boolean;
}> {
  const socket = connect(port, "127.0.0.1");
  socket.setEncoding("utf8");
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
  let raw = "";
  let sent = 0;
  let waited = false;
  let reset = false;
  return new Promise((settled) => {
    const settle = (): void => {
      settled({ status: finalStatus(raw), sent, body: raw, reset });
      socket.destroy();
    };
    const giveUp = setTimeout(settle, 10_000);
    const finish = (): void => {
      clearTimeout(giveUp);
      settle();
    };
    socket.on("data", (text: string) => {
      raw += text;
      // A 100 is the only answer that is not the end of it, so the body goes out
      // on that one and nowhere else.
      if (!waited && statusLines(raw).includes("HTTP/1.1 100")) {
        waited = true;
        sent = socket.write(bytes) ? bytes.byteLength : 0;
        return;
      }
      if (!raw.endsWith("\r\n\r\n")) {
        return;
      }
      finish();
    });
    socket.on("error", (error: NodeJS.ErrnoException) => {
      reset = error.code === "ECONNRESET";
      finish();
    });
    socket.on("close", finish);
    socket.on("connect", () => {
      socket.write(
        [
          requestLine,
          "Host: localhost",
          ...headers,
          "Connection: close",
          "",
          "",
        ].join("\r\n"),
      );
      if (!waitForContinue) {
        sent = socket.write(bytes) ? bytes.byteLength : 0;
      }
    });
  });
}

/**
 * A client that sends its head and waits. Whatever the server answers, only then
 * does it offer the body — so a server that refused before reading is never
 * given one, and a server that read before refusing has already taken it.
 */
async function headOnlyRequest(
  port: number,
  requestLine: string,
  headers: readonly string[],
  body: string | Buffer,
): Promise<{ status: string; read: number; written: number; failed: boolean }> {
  const socket = connect(port, "127.0.0.1");
  socket.setEncoding("utf8");
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
  const chunk = 65_536;
  let raw = "";
  let read = 0;
  let failed = false;
  return new Promise((settled) => {
    const finish = (): void => {
      clearTimeout(giveUp);
      socket.destroy();
      settled({
        status: finalStatus(raw),
        read,
        written: bytes.byteLength,
        failed,
      });
    };
    const giveUp = setTimeout(finish, 10_000);
    const pump = (): void => {
      while (read < bytes.byteLength && socket.writable && raw === "") {
        const slice = bytes.subarray(
          read,
          Math.min(read + chunk, bytes.byteLength),
        );
        if (!socket.write(slice)) {
          break;
        }
        read += slice.byteLength;
      }
    };
    socket.on("data", (text: string) => {
      raw += text;
      if (raw !== "") {
        return;
      }
      // The answer is here: the body is either refused by a closed socket or
      // accepted by a paused reader. Try once, then stop.
      pump();
    });
    socket.on("error", () => {
      failed = true;
      finish();
    });
    socket.on("close", finish);
    socket.on("connect", () => {
      socket.write(
        [
          requestLine,
          "Host: localhost",
          ...headers,
          "Connection: close",
          "",
          "",
        ].join("\r\n"),
      );
    });
  });
}

export async function startHarness(
  options: HarnessOptions = {},
): Promise<Started> {
  const lines: string[] = [];
  const sockets: Socket[] = [];
  const server: Server = createHttpServer({
    store: options.store ?? new MemoryStore(),
    now: options.now ?? (() => NOW_MS),
    publicDir: options.publicDir ?? (await publicDir()),
    readToken: options.readToken,
    adminToken: options.adminToken,
    trustProxy: options.trustProxy,
    compare: options.compare,
    mint: options.mint,
    log: (line) => {
      lines.push(line);
      allLines.push(line);
    },
  });
  server.on("connection", (socket) => {
    sockets.push(socket);
  });
  await new Promise<void>((listening) => {
    server.listen(0, "127.0.0.1", listening);
  });
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  for (const secret of [options.readToken, options.adminToken]) {
    if (secret !== undefined) {
      watchSecret(secret);
    }
  }
  const close = (): Promise<void> =>
    new Promise<void>((closed) => {
      server.close(() => closed());
      server.closeAllConnections();
    });
  cleanups.push(close);
  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    logLines: () => [...lines],
    raw: (requestLine, headers = [], body = "") =>
      rawRequest(port, requestLine, headers, body),
    expecting: (requestLine, headers, body, options) =>
      expectingRequest(
        port,
        requestLine,
        headers,
        body,
        options?.waitForContinue !== false,
      ),
    headOnly: (requestLine, headers, body) =>
      headOnlyRequest(port, requestLine, headers, body),
    bytesRead: () =>
      sockets.reduce((total, socket) => total + socket.bytesRead, 0),
    sockets: () =>
      sockets.map((socket) => ({
        destroyed: socket.destroyed,
        writableEnded: socket.writableEnded,
      })),
    stop: close,
  };
}
