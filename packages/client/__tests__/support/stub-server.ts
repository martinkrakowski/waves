import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { isProjectId, validateEnvelope } from "@hexagen-monaco/waves-contract";

export const STUB_ADMIN_TOKEN = "waves-stub-admin-t0ken-1a2b3c";

const MAX_BODY_BYTES = 1_048_576;
const JSON_TYPE = "application/json";
const RETRY_AFTER_SECONDS = "1";
const STUB_CLOCK = Date.parse("2026-02-03T00:00:00.000Z");
const CLOCK_TOLERANCE_MS = 400 * 24 * 60 * 60 * 1000;

export interface StubRequest {
  readonly method: string;
  readonly path: string;
  readonly body: string;
  readonly authorization: string | undefined;
  readonly contentType: string | undefined;
  readonly origin: string | undefined;
}

export interface Stub {
  readonly origin: string;
  readonly requests: StubRequest[];
  /** The token of a project, once it has been registered. */
  tokenOf(project: string): string | undefined;
  stop(): Promise<void>;
}

interface Recorded {
  readonly body: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly method: string;
  readonly url: URL;
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

function send(res: ServerResponse, status: number, payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    "Content-Type": JSON_TYPE,
    "Content-Length": String(body.byteLength),
  });
  res.end(body);
}

function bearer(headers: Recorded["headers"]): string | undefined {
  const header = headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    return undefined;
  }
  return header.slice("Bearer ".length);
}

/**
 * A stand-in for the server the other lane is building: the three endpoints the
 * client calls, the status codes the brief lists, and one rule the client cannot
 * check for itself — a snapshot whose `generatedAt` is nowhere near the server's
 * clock is refused, because the status view would show a wave in the future.
 */
export async function startStub(): Promise<Stub> {
  const projects = new Map<string, string>();
  const stored = new Set<string>();
  const throttled = new Set<string>();
  const requests: StubRequest[] = [];
  let issued = 0;

  const handle = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const body = await readBody(req);
    const recorded: Recorded = {
      body,
      headers: req.headers,
      method: req.method ?? "GET",
      url,
    };
    requests.push({
      method: recorded.method,
      path: `${url.pathname}${url.search}`,
      body,
      authorization: req.headers.authorization,
      contentType: req.headers["content-type"],
      origin: req.headers.origin,
    });

    const parts = url.pathname.split("/");
    if (
      parts.length === 4 &&
      parts[1] === "api" &&
      parts[2] === "v1" &&
      parts[3] === "projects"
    ) {
      registerProject(recorded, res);
      return;
    }
    if (
      parts.length === 7 &&
      parts[1] === "api" &&
      parts[2] === "v1" &&
      parts[3] === "projects" &&
      parts[5] === "waves"
    ) {
      wave(recorded, res, parts[4] ?? "", parts[6] ?? "");
      return;
    }
    send(res, 404, { message: "no such route" });
  };

  function registerProject(recorded: Recorded, res: ServerResponse): void {
    if (recorded.method !== "POST") {
      send(res, 405, { message: "use POST" });
      return;
    }
    if (bearer(recorded.headers) !== STUB_ADMIN_TOKEN) {
      send(res, 401, { message: "the admin token was refused" });
      return;
    }
    let request: { readonly id?: unknown; readonly name?: unknown };
    try {
      request = JSON.parse(recorded.body) as typeof request;
    } catch {
      send(res, 400, { message: "the body is not JSON" });
      return;
    }
    const id = typeof request.id === "string" ? request.id : "";
    if (!isProjectId(id) || typeof request.name !== "string") {
      send(res, 422, {
        errors: [
          {
            path: "/id",
            message: "expected 1 to 63 characters of a-z, 0-9 and -",
          },
        ],
      });
      return;
    }
    const rotate = recorded.url.searchParams.get("rotate") === "1";
    if (projects.has(id) && !rotate) {
      send(res, 409, { message: "the project is already registered" });
      return;
    }
    issued += 1;
    const token = `waves-stub-project-t0ken-${id}-${issued}`;
    projects.set(id, token);
    send(res, 201, { id, token });
  }

  function wave(
    recorded: Recorded,
    res: ServerResponse,
    project: string,
    waveId: string,
  ): void {
    if (recorded.method === "DELETE") {
      const key = `${project}/${waveId}`;
      if (!stored.delete(key)) {
        send(res, 404, { message: "no such wave" });
        return;
      }
      res.writeHead(204).end();
      return;
    }
    if (recorded.method !== "PUT") {
      send(res, 405, { message: "use PUT" });
      return;
    }
    if (recorded.headers.origin !== undefined) {
      send(res, 403, { message: "a browser must not push a wave" });
      return;
    }
    const token = bearer(recorded.headers);
    if (token === undefined || !projects.has(project)) {
      send(res, 401, { message: "the project token was refused" });
      return;
    }
    if (projects.get(project) !== token) {
      send(res, 403, { message: "that token belongs to another project" });
      return;
    }
    if (
      recorded.headers["content-type"] !== `${JSON_TYPE}; charset=utf-8` &&
      recorded.headers["content-type"] !== JSON_TYPE
    ) {
      send(res, 415, { message: "expected application/json" });
      return;
    }
    const key = `${project}/${waveId}`;
    if (!throttled.has(key)) {
      throttled.add(key);
      res
        .writeHead(429, {
          "Content-Type": JSON_TYPE,
          "Retry-After": RETRY_AFTER_SECONDS,
        })
        .end(JSON.stringify({ message: "slow down" }));
      return;
    }
    let envelope: unknown;
    try {
      envelope = JSON.parse(recorded.body);
    } catch {
      send(res, 400, { message: "the body is not JSON" });
      return;
    }
    const validated = validateEnvelope(envelope);
    if (!validated.ok) {
      send(res, 422, { errors: validated.errors });
      return;
    }
    const generatedAt = Date.parse(validated.value.generatedAt);
    if (Math.abs(generatedAt - STUB_CLOCK) > CLOCK_TOLERANCE_MS) {
      send(res, 422, {
        errors: [
          { path: "/generatedAt", message: "too far from the server clock" },
        ],
      });
      return;
    }
    stored.add(key);
    send(res, 200, { receivedAt: new Date().toISOString() });
  }

  const server: Server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) {
        send(res, 500, { message: "the stub failed" });
      }
    });
  });
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
