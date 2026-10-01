#!/usr/bin/env node
import { fileURLToPath } from "node:url";

import { type Config, parseConfig } from "./application/config.js";
import { FileStore } from "./infrastructure/file-store.js";
import { createHttpServer } from "./infrastructure/http-server.js";
import { listen } from "./infrastructure/listen.js";
import { readReadToken } from "./infrastructure/read-token.js";

const SHUTDOWN_MS = 5000;
const EXIT_INVALID_ENVIRONMENT = 2;

const io = {
  out: (line: string): void => {
    process.stdout.write(`${line}\n`);
  },
  err: (line: string): void => {
    process.stderr.write(`${line}\n`);
  },
};

function fail(error: unknown): number {
  io.err(`waves: ${error instanceof Error ? error.message : String(error)}`);
  return EXIT_INVALID_ENVIRONMENT;
}

function readConfig(): Config | undefined {
  try {
    return parseConfig(process.env);
  } catch (error) {
    fail(error);
    return undefined;
  }
}

async function loadReadToken(config: Config): Promise<string | undefined> {
  try {
    return config.readTokenFile === undefined
      ? undefined
      : await readReadToken(config.readTokenFile);
  } catch (error) {
    fail(error);
    return undefined;
  }
}

async function start(): Promise<number> {
  const config = readConfig();
  if (config === undefined) {
    return EXIT_INVALID_ENVIRONMENT;
  }
  const readToken = await loadReadToken(config);
  if (config.readTokenFile !== undefined && readToken === undefined) {
    return EXIT_INVALID_ENVIRONMENT;
  }

  const server = createHttpServer({
    store: new FileStore(config.dataDir),
    now: () => Date.now(),
    publicDir: fileURLToPath(new URL("../public", import.meta.url)),
    readToken,
    log: io.out,
  });

  const shutdown = (): void => {
    const forced = setTimeout(() => {
      process.exit(0);
    }, SHUTDOWN_MS);
    forced.unref();
    server.close(() => {
      clearTimeout(forced);
      process.exit(0);
    });
    server.closeIdleConnections();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  const bound = await listen(server, config.host, config.port);
  if (!bound.ok) {
    io.err(`waves: ${bound.message}`);
    return EXIT_INVALID_ENVIRONMENT;
  }
  io.out(`waves: listening on ${config.host}:${config.port}`);
  return 0;
}

process.exitCode = await start();
