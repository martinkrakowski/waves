import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { resolve } from "node:path";

import type { Project, StoredSnapshot } from "@hexagen-monaco/waves-contract";

import type { DigestComparer } from "../application/bearer.js";
import {
  createFailureLimiter,
  createRateLimiter,
} from "../application/limiters.js";
import type { Now } from "../application/read-model.js";
import { createReadModel, type ReadModel } from "../application/read-model.js";
import type { StorePort } from "../application/ports/store.js";
import { digestsEqual, mintToken } from "./digest.js";
import {
  authorised,
  CHALLENGE,
  type Headers,
  jsonReply,
  NO_STORE,
  parserRefusal,
  type Reply,
  refuseParsedRequest,
  send,
  sha256,
} from "./http-security.js";
import {
  allowOf,
  HEALTH_PATH,
  isApiPath,
  MAX_URL_BYTES,
  pathOf,
  READY_PATH,
  type Route,
  route,
} from "./http-routes.js";
import { createWriteHandler } from "./http-write.js";
import {
  HTML_TYPE,
  readStaticFile,
  realRootOf,
  type StaticFile,
} from "./http-static.js";

const INDEX_FILE = "index.html";
const READ_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);
const WRITE_METHODS: ReadonlySet<string> = new Set(["PUT", "POST", "DELETE"]);

/** The paths no token guards: one says the process is up, the other that it works. */
const OPEN_PATHS: ReadonlySet<string> = new Set([HEALTH_PATH, READY_PATH]);

const HEADERS_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_HEADER_BYTES = 16_384;

const NOT_FOUND: Reply = jsonReply(404, { error: "not found" });

export interface HttpServerDeps {
  readonly store: StorePort<Project, StoredSnapshot>;
  readonly now: Now;
  readonly publicDir: string;
  readonly log: (line: string) => void;
  readonly readToken?: string;
  /** undefined leaves the admin routes disabled, so they answer 404. */
  readonly adminToken?: string;
  readonly trustProxy?: boolean;
  readonly compare?: DigestComparer;
  readonly mint?: () => string;
}

async function staticReply(
  realRoot: string | undefined,
  file: StaticFile,
): Promise<Reply> {
  if (realRoot === undefined) {
    return NOT_FOUND;
  }
  const body = await readStaticFile(realRoot, file);
  if (body === undefined) {
    return NOT_FOUND;
  }
  return { status: 200, type: file.type, body };
}

/**
 * Readiness is the store being readable, not the process being alive: a pod
 * whose volume the store refuses answers 200 to /healthz and 500 to everything
 * else, and telling those apart is what a readiness probe is for. It carries no
 * token, so the probe does not have to hold a secret to see it.
 */
async function readyReply(
  store: StorePort<Project, StoredSnapshot>,
): Promise<Reply> {
  try {
    await store.listProjects();
    return jsonReply(200, { ok: true });
  } catch {
    return jsonReply(503, { ok: false });
  }
}

async function replyFor(
  matched: Route,
  readModel: ReadModel,
  store: StorePort<Project, StoredSnapshot>,
  root: string,
  realRoot: string | undefined,
): Promise<Reply> {
  switch (matched.kind) {
    case "health":
      return jsonReply(200, { ok: true });
    case "ready":
      return readyReply(store);
    case "projects":
      return jsonReply(200, await readModel.listProjects());
    case "waves": {
      const waves = await readModel.listWaves(matched.project);
      return waves === undefined ? NOT_FOUND : jsonReply(200, waves);
    }
    case "wave": {
      const view = await readModel.getWave(matched.project, matched.wave);
      return view === undefined ? NOT_FOUND : jsonReply(200, view);
    }
    case "index":
      return staticReply(realRoot, {
        path: resolve(root, INDEX_FILE),
        type: HTML_TYPE,
      });
    case "file":
      return staticReply(realRoot, matched.file);
    default:
      // A project path carries no read representation, and a path that is not a
      // route at all has nothing to answer.
      return NOT_FOUND;
  }
}

/**
 * Health, readiness, the two listings, the wave views and the placeholder page,
 * plus the whole write path. The read token guards only what it did before — the
 * GET and HEAD routes, and neither probe — because a project pushing a wave
 * holds a project token and has no read token; a write is answered with a bearer
 * token or with nothing at all, and every response carries the same security
 * headers.
 */
/** Anything under the API prefix is never cached; the page and its assets may be. */
function extraFor(pathname: string): Headers {
  return isApiPath(pathname) ? NO_STORE : {};
}

export function createHttpServer(deps: HttpServerDeps): Server {
  const { store, now, publicDir, log, readToken } = deps;
  const root = resolve(publicDir);
  const expected = readToken === undefined ? undefined : sha256(readToken);
  const readModel = createReadModel({ store, now });
  const realRoot = realRootOf(root);
  const compare: DigestComparer = deps.compare ?? digestsEqual;
  const write = createWriteHandler({
    store,
    now,
    adminToken: deps.adminToken,
    trustProxy: deps.trustProxy === true,
    compare,
    mintToken: deps.mint ?? mintToken,
    digestHex: (token: string): string => sha256(token).toString("hex"),
    failures: createFailureLimiter(now),
    rate: createRateLimiter(now),
  });

  const respond = async (
    req: IncomingMessage,
    res: ServerResponse,
    method: string,
    target: string,
    pathname: string,
  ): Promise<number> => {
    if (Buffer.byteLength(target) > MAX_URL_BYTES) {
      return send(res, jsonReply(414, { error: "uri too long" }), { method });
    }
    const matched = route(pathname, root);
    if (WRITE_METHODS.has(method)) {
      return write(req, res, method, target, matched);
    }
    const extra = extraFor(pathname);
    if (matched.kind === "ready" && READ_METHODS.has(method)) {
      return send(
        res,
        await replyFor(matched, readModel, store, root, await realRoot),
        {
          method,
          extra: { ...extra, ...NO_STORE },
        },
      );
    }
    if (
      expected !== undefined &&
      !OPEN_PATHS.has(pathname) &&
      !authorised(req, expected)
    ) {
      return send(res, jsonReply(401, { error: "unauthorized" }), {
        method,
        extra: { ...extra, "WWW-Authenticate": CHALLENGE },
      });
    }
    if (!READ_METHODS.has(method) || matched.kind === "project") {
      return send(res, jsonReply(405, { error: "method not allowed" }), {
        method,
        extra: { ...extra, Allow: allowOf(matched) },
      });
    }
    const reply = await replyFor(
      matched,
      readModel,
      store,
      root,
      await realRoot,
    );
    return send(res, reply, { method, extra });
  };

  const handle = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    const startedMs = now();
    const method = String(req.method);
    const target = String(req.url);
    const pathname = pathOf(target);
    let status: number;
    try {
      status = await respond(req, res, method, target, pathname);
    } catch (error) {
      log(
        JSON.stringify({
          ts: new Date(startedMs).toISOString(),
          level: "error",
          method,
          path: pathname,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }),
      );
      status = send(res, jsonReply(500, { error: "internal" }), {
        method,
        extra: extraFor(pathname),
      });
    }
    logAnswer(startedMs, method, pathname, status);
  };

  /** The one access-log line every answer carries, whoever wrote it. */
  const logAnswer = (
    startedMs: number,
    method: string,
    pathname: string,
    status: number,
  ): void => {
    log(
      JSON.stringify({
        ts: new Date(startedMs).toISOString(),
        method,
        path: pathname,
        status,
        ms: now() - startedMs,
      }),
    );
  };

  const server = createServer(
    {
      headersTimeout: HEADERS_TIMEOUT_MS,
      requestTimeout: REQUEST_TIMEOUT_MS,
      maxHeaderSize: MAX_HEADER_BYTES,
    },
    (req, res) => {
      void handle(req, res);
    },
  );
  // A listener here suppresses Node's automatic 100 and its `request` event for
  // every request that asked to wait, so this is the only way such a request
  // gets handled at all. It goes through the same handler as every other
  // request, for every method: what a write does with `Expect` is the write
  // pipeline's business, and answering it before authentication would be the one
  // way to make it cheaper to refuse than to accept.
  server.on("checkContinue", (req, res) => {
    void handle(req, res);
  });
  // An `Expect` this server does not implement is refused before the request is
  // ever routed: there is no body it would read, and the client asked for a
  // promise nobody is going to keep. Answering it here rather than letting Node
  // answer it is what keeps the refusal in the same shape as every other one —
  // the security headers, the JSON body and the access-log line included — and
  // the socket goes with it, so a body still on its way is never drained.
  server.on("checkExpectation", (req, res) => {
    const startedMs = now();
    const method = String(req.method);
    const pathname = pathOf(String(req.url));
    const status = send(res, jsonReply(417, { error: "expectation failed" }), {
      method,
      extra: extraFor(pathname),
      socket: req.socket,
    });
    logAnswer(startedMs, method, pathname, status);
  });
  server.on("clientError", (error, socket) => {
    refuseParsedRequest(socket, parserRefusal(error));
  });
  return server;
}
