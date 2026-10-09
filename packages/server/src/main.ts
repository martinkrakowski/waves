#!/usr/bin/env node
import { fileURLToPath } from "node:url";

import { type Config, parseConfig } from "./application/config.js";
import {
  readAdminToken,
  readEnrollToken,
  sameToken,
  type SecretToken,
} from "./infrastructure/admin-token.js";
import { FileStore } from "./infrastructure/file-store.js";
import { FileNoticeStore } from "./infrastructure/file-notice-store.js";
import { createHttpServer } from "./infrastructure/http-server.js";
import { listen } from "./infrastructure/listen.js";
import { readReadToken } from "./infrastructure/read-token.js";
import { sha256Hex } from "./infrastructure/sha256.js";

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

type SecretLoad =
  | { readonly kind: "enabled"; readonly token: string }
  | { readonly kind: "absent" }
  | { readonly kind: "failed" };

/**
 * Both service tokens are read once, here, and only their digests are ever used.
 * A missing file is not a failure: what that token could do is then disabled,
 * which the one line each caller prints is the only trace of, so an operator can
 * tell a disabled token from a broken one without either value ever appearing
 * anywhere.
 */
async function loadSecret(
  path: string | undefined,
  read: (path: string) => Promise<SecretToken>,
): Promise<SecretLoad> {
  if (path === undefined) {
    return { kind: "absent" };
  }
  try {
    return await read(path);
  } catch (error) {
    fail(error);
    return { kind: "failed" };
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
  const admin = await loadSecret(config.adminTokenFile, readAdminToken);
  if (admin.kind === "failed") {
    return EXIT_INVALID_ENVIRONMENT;
  }
  if (admin.kind === "absent") {
    io.out("waves: admin routes disabled");
  }
  const enroll = await loadSecret(config.enrollTokenFile, readEnrollToken);
  if (enroll.kind === "failed") {
    return EXIT_INVALID_ENVIRONMENT;
  }
  if (enroll.kind === "absent") {
    io.out("waves: enrollment disabled");
  }
  // One value behind two names would hand every admin power to wherever the
  // enrollment copy lives, so the process refuses to start rather than run with
  // it. The comparison is over digests, never over the values themselves.
  if (
    admin.kind === "enabled" &&
    enroll.kind === "enabled" &&
    sameToken(admin.token, enroll.token)
  ) {
    io.err(
      "waves: WAVES_ENROLL_TOKEN_FILE holds the admin token; the two must differ",
    );
    return EXIT_INVALID_ENVIRONMENT;
  }

  const server = createHttpServer({
    store: new FileStore(config.dataDir),
    noticeStore: new FileNoticeStore(config.dataDir),
    now: () => Date.now(),
    hashText: sha256Hex,
    publicDir: fileURLToPath(new URL("../public", import.meta.url)),
    readToken,
    adminToken: admin.kind === "enabled" ? admin.token : undefined,
    enrollToken: enroll.kind === "enabled" ? enroll.token : undefined,
    trustProxy: config.trustProxy,
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
