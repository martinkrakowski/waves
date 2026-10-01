import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { resolve } from "node:path";

import type { Now } from "../application/read-model.js";
import { createReadModel, type ReadModel } from "../application/read-model.js";
import type {
  ProjectRecord,
  StoredSnapshotRecord,
} from "../application/ports/model.js";
import type { StorePort } from "../application/ports/store.js";
import { contractStaleness } from "./contract-staleness.js";
import {
  ALLOW_GET_HEAD,
  authorised,
  CHALLENGE,
  type Headers,
  jsonReply,
  NO_STORE,
  type Reply,
  send,
  sha256,
} from "./http-security.js";
import {
  HEALTH_PATH,
  isApiPath,
  MAX_URL_BYTES,
  pathOf,
  type Route,
  route,
} from "./http-routes.js";
import { HTML_TYPE, readStaticFile, type StaticFile } from "./http-static.js";

const INDEX_FILE = "index.html";
const READ_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

const NOT_FOUND: Reply = jsonReply(404, { error: "not found" });

export interface HttpServerDeps {
  readonly store: StorePort<ProjectRecord, StoredSnapshotRecord>;
  readonly now: Now;
  readonly publicDir: string;
  readonly log: (line: string) => void;
  readonly readToken?: string;
}

async function staticReply(file: StaticFile): Promise<Reply> {
  const body = await readStaticFile(file);
  if (body === undefined) {
    return NOT_FOUND;
  }
  return { status: 200, type: file.type, body };
}

async function replyFor(
  matched: Route,
  readModel: ReadModel,
  root: string,
): Promise<Reply> {
  switch (matched.kind) {
    case "health":
      return jsonReply(200, { ok: true });
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
      return staticReply({ path: resolve(root, INDEX_FILE), type: HTML_TYPE });
    case "file":
      return staticReply(matched.file);
    case "missing":
      return NOT_FOUND;
  }
}

/**
 * The read-only HTTP surface: health, the two listings, the wave views and the
 * placeholder page. Only GET and HEAD are answered, an optional read token
 * guards everything but health, and every response carries the same security
 * headers.
 */
export function createHttpServer(deps: HttpServerDeps): Server {
  const { store, now, publicDir, log, readToken } = deps;
  const root = resolve(publicDir);
  const expected = readToken === undefined ? undefined : sha256(readToken);
  const readModel = createReadModel({
    store,
    now,
    staleness: contractStaleness,
  });

  const respond = async (
    req: IncomingMessage,
    res: ServerResponse,
    method: string,
    target: string,
    pathname: string,
    extra: Headers,
  ): Promise<number> => {
    if (Buffer.byteLength(target) > MAX_URL_BYTES) {
      return send(
        res,
        jsonReply(414, { error: "uri too long" }),
        method,
        extra,
      );
    }
    if (
      expected !== undefined &&
      pathname !== HEALTH_PATH &&
      !authorised(req, expected)
    ) {
      return send(res, jsonReply(401, { error: "unauthorized" }), method, {
        ...extra,
        "WWW-Authenticate": CHALLENGE,
      });
    }
    if (!READ_METHODS.has(method)) {
      return send(
        res,
        jsonReply(405, { error: "method not allowed" }),
        method,
        { ...extra, ...ALLOW_GET_HEAD },
      );
    }
    const reply = await replyFor(route(pathname, root), readModel, root);
    return send(res, reply, method, extra);
  };

  const handle = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    const startedMs = now();
    const method = String(req.method);
    const target = String(req.url);
    const pathname = pathOf(target);
    const extra: Headers = isApiPath(pathname) ? NO_STORE : {};
    let status: number;
    try {
      status = await respond(req, res, method, target, pathname, extra);
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
      status = send(res, jsonReply(500, { error: "internal" }), method, extra);
    }
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

  return createServer((req, res) => {
    void handle(req, res);
  });
}
