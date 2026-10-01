import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Project, StoredSnapshot } from "@hexagen-monaco/waves-contract";

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
  ) => Promise<string>;
  readonly stop: () => Promise<void>;
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

async function rawRequest(
  port: number,
  requestLine: string,
  headers: readonly string[],
): Promise<string> {
  const socket = connect(port, "127.0.0.1");
  socket.setEncoding("utf8");
  const chunks: string[] = [];
  socket.on("data", (chunk: string) => chunks.push(chunk));
  await new Promise<void>((ready) => {
    socket.on("connect", () => ready());
  });
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
  await new Promise<void>((ended) => {
    socket.on("close", () => ended());
  });
  socket.destroy();
  return chunks.join("");
}

export async function startHarness(
  options: HarnessOptions = {},
): Promise<Started> {
  const lines: string[] = [];
  const server: Server = createHttpServer({
    store: options.store ?? new MemoryStore(),
    now: options.now ?? (() => NOW_MS),
    publicDir: options.publicDir ?? (await publicDir()),
    readToken: options.readToken,
    log: (line) => {
      lines.push(line);
    },
  });
  await new Promise<void>((listening) => {
    server.listen(0, "127.0.0.1", listening);
  });
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  cleanups.push(
    () =>
      new Promise<void>((closed) => {
        server.close(() => closed());
        server.closeAllConnections();
      }),
  );
  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    logLines: () => [...lines],
    raw: (requestLine, headers = []) => rawRequest(port, requestLine, headers),
    stop: () =>
      new Promise<void>((closed) => {
        server.close(() => closed());
        server.closeAllConnections();
      }),
  };
}
