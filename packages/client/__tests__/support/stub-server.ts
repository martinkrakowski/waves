import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { isProjectId, validateEnvelope } from "@hexagen-monaco/waves-contract";

import { registerSecret } from "./harness.js";

export const STUB_ADMIN_TOKEN = "waves-stub-admin-t0ken-1a2b3c";

registerSecret(STUB_ADMIN_TOKEN);

const MAX_BODY_BYTES = 1_048_576;
const JSON_TYPE = "application/json";
const RETRY_AFTER_SECONDS = "1";
const CHALLENGE = 'Bearer realm="waves"';
const STUB_CLOCK = Date.parse("2026-02-03T00:00:00.000Z");
const CLOCK_TOLERANCE_MS = 400 * 24 * 60 * 60 * 1000;

export interface StubRequest {
  readonly method: string;
  readonly path: string;
  /** Filled in only for a request the stub was willing to read to the end. */
  body: string;
  readonly authorization: string | undefined;
  readonly contentType: string | undefined;
  readonly expect: string | undefined;
  readonly origin: string | undefined;
}

export interface Stub {
  readonly origin: string;
  readonly requests: StubRequest[];
  /** The token of a project, once it has been registered. */
  tokenOf(project: string): string | undefined;
  /** The requests that carried a body, which is every accepted push. */
  bodies(): readonly string[];
  stop(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("too big"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

/** `{error}` for everything but a 422, which the contract answers with pointers. */
function send(
  res: ServerResponse,
  status: number,
  error: string,
  headers: Record<string, string> = {},
): void {
  sendJson(res, status, { error }, headers);
}

function sendJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): void {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    "Content-Type": JSON_TYPE,
    "Content-Length": String(body.byteLength),
    ...headers,
  });
  res.end(body);
}

function bearer(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (header === undefined || !header.startsWith("Bearer ")) {
    return undefined;
  }
  return header.slice("Bearer ".length);
}

/**
 * A stand-in for the server the other lane is building: the three endpoints the
 * client calls, the shapes it really answers with, and the two behaviours that
 * shape the client — a refusal on the headers alone, which never reads the
 * snapshot, and one rule the client cannot check for itself, since a snapshot
 * whose `generatedAt` is nowhere near the server's clock is refused because the
 * status view would show a wave in the future.
 */
export async function startStub(): Promise<Stub> {
  const projects = new Map<string, string>();
  const stored = new Set<string>();
  const throttled = new Set<string>();
  const requests: StubRequest[] = [];
  let issued = 0;

  const record = (req: IncomingMessage): StubRequest => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const entry: StubRequest = {
      method: req.method ?? "GET",
      path: `${url.pathname}${url.search}`,
      body: "",
      authorization: req.headers.authorization,
      contentType: req.headers["content-type"],
      expect: req.headers.expect,
      origin: req.headers.origin,
    };
    requests.push(entry);
    return entry;
  };

  const handle = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    const entry = record(req);
    const parts = (req.url ?? "/").split("?")[0]?.split("/") ?? [];
    if (
      parts.length === 4 &&
      parts[1] === "api" &&
      parts[2] === "v1" &&
      parts[3] === "projects"
    ) {
      await registerProject(req, res);
      return;
    }
    if (
      parts.length === 7 &&
      parts[1] === "api" &&
      parts[2] === "v1" &&
      parts[3] === "projects" &&
      parts[5] === "waves"
    ) {
      await wave(req, res, entry, parts[4] ?? "", parts[6] ?? "");
      return;
    }
    send(res, 404, "no such route");
  };

  async function registerProject(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (req.method !== "POST") {
      send(res, 405, "use POST");
      return;
    }
    if (bearer(req) !== STUB_ADMIN_TOKEN) {
      send(res, 401, "the admin token was refused", {
        "WWW-Authenticate": CHALLENGE,
      });
      return;
    }
    if (req.headers.expect === "100-continue") {
      res.writeContinue();
    }
    const text = await readBody(req);
    let request: { readonly id?: unknown; readonly name?: unknown };
    try {
      request = JSON.parse(text) as typeof request;
    } catch {
      send(res, 400, "the body is not JSON");
      return;
    }
    const id = typeof request.id === "string" ? request.id : "";
    if (!isProjectId(id) || typeof request.name !== "string") {
      send(res, 422, "the project is not one the server will store");
      return;
    }
    const rotate = (req.url ?? "").includes("rotate=1");
    if (projects.has(id) && !rotate) {
      send(res, 409, "the project is already registered");
      return;
    }
    issued += 1;
    const token = `waves-stub-project-t0ken-${issued}`;
    registerSecret(token);
    projects.set(id, token);
    sendJson(res, 201, { id, token });
  }

  async function wave(
    req: IncomingMessage,
    res: ServerResponse,
    entry: StubRequest,
    project: string,
    waveId: string,
  ): Promise<void> {
    if (req.method === "DELETE") {
      if (bearer(req) !== projects.get(project)) {
        send(res, 401, "the project token was refused", {
          "WWW-Authenticate": CHALLENGE,
        });
        return;
      }
      if (!stored.delete(`${project}/${waveId}`)) {
        send(res, 404, "no such wave");
        return;
      }
      res.writeHead(204).end();
      return;
    }
    if (req.method !== "PUT") {
      send(res, 405, "use PUT");
      return;
    }
    // Everything from here to the body is a judgement about the headers alone.
    // A refusal answered here never reads the snapshot, whatever its size.
    if (entry.origin !== undefined) {
      send(res, 403, "a browser must not push a wave");
      return;
    }
    const token = bearer(req);
    if (token === undefined || !projects.has(project)) {
      send(res, 401, "the project token was refused", {
        "WWW-Authenticate": CHALLENGE,
      });
      return;
    }
    if (projects.get(project) !== token) {
      send(res, 403, "that token belongs to another project");
      return;
    }
    if (entry.contentType !== JSON_TYPE) {
      send(res, 415, "expected application/json");
      return;
    }
    const key = `${project}/${waveId}`;
    if (!throttled.has(key)) {
      throttled.add(key);
      send(res, 429, "slow down", { "Retry-After": RETRY_AFTER_SECONDS });
      return;
    }
    if (entry.expect === "100-continue") {
      res.writeContinue();
    }
    entry.body = await readBody(req);
    let envelope: unknown;
    try {
      envelope = JSON.parse(entry.body);
    } catch {
      send(res, 400, "the body is not JSON");
      return;
    }
    const validated = validateEnvelope(envelope);
    if (!validated.ok) {
      sendJson(res, 422, { errors: validated.errors });
      return;
    }
    if (
      Math.abs(Date.parse(validated.value.generatedAt) - STUB_CLOCK) >
      CLOCK_TOLERANCE_MS
    ) {
      sendJson(res, 422, {
        errors: [
          { path: "/generatedAt", message: "too far from the server clock" },
        ],
      });
      return;
    }
    stored.add(key);
    sendJson(res, 200, { receivedAt: new Date().toISOString() });
  }

  const dispatch = (req: IncomingMessage, res: ServerResponse): void => {
    handle(req, res).catch(() => {
      if (!res.headersSent) {
        send(res, 500, "the stub failed");
      }
    });
  };

  const server: Server = createServer(dispatch);
  // A request that expects a decision on its headers never becomes a request
  // until the stub has answered it.
  server.on("checkContinue", dispatch);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the stub has no port");
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    tokenOf: (project: string) => projects.get(project),
    bodies: () =>
      requests.filter((entry) => entry.body !== "").map((entry) => entry.body),
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        });
      }),
  };
}
