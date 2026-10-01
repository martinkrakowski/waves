import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Project, StoredSnapshot } from "@hexagen-monaco/waves-contract";

import type { DigestComparer } from "../src/application/bearer.js";
import type { StorePort } from "../src/application/ports/store.js";
import { createHttpServer } from "../src/infrastructure/http-server.js";
import { MemoryStore } from "../src/infrastructure/memory-store.js";
import {
  expectingRequest,
  type RawResult,
  rawRequest,
  sendAndHold,
} from "./raw-client.js";

export { finalStatus, statusLines } from "./raw-client.js";

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
   * A client that waits for a `100` before sending its body, and reports what it
   * read, what it wrote and whether it was reset. `undici` cannot send `Expect`.
   */
  readonly expecting: (
    requestLine: string,
    headers: readonly string[],
    body: string | Buffer,
    options?: { readonly waitForContinue?: boolean },
  ) => Promise<RawResult>;
  /**
   * A client that sends everything and holds the socket open, which is how a test
   * watches a server drop a connection it is still being written to. With
   * `keepAlive` it asks for no close on its behalf either, so the only thing that
   * can end the connection is the server's own decision.
   */
  readonly sendAndHold: (
    requestLine: string,
    headers: readonly string[],
    body: string | Buffer,
    options?: { readonly keepAlive?: boolean },
  ) => Promise<RawResult>;
  /**
   * The bytes the server has taken off its own sockets, which is how a test
   * shows that a request body was never read rather than merely refused.
   */
  readonly bytesRead: () => number;
  /**
   * The server-side sockets as they are now, so a test can watch one being
   * dropped without waiting on a client to notice.
   */
  readonly sockets: () => readonly {
    readonly destroyed: boolean;
    readonly writableEnded: boolean;
  }[];
  readonly stop: () => Promise<void>;
}

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

const cleanups: (() => Promise<void>)[] = [];

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
    expecting: (requestLine, headers, body, expecting) =>
      expectingRequest(
        port,
        requestLine,
        headers,
        body,
        expecting?.waitForContinue !== false,
      ),
    sendAndHold: (requestLine, headers, body, holding) =>
      sendAndHold(
        port,
        requestLine,
        headers,
        body,
        holding?.keepAlive === true,
      ),
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
