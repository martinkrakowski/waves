import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";

import {
  validateEnvelope,
  type Project,
  type StoredSnapshot,
  type ValidationIssue,
} from "@hexagen-monaco/waves-contract";

import {
  bearerToken,
  type Digest,
  type DigestComparer,
  createAuthenticator,
  matches,
} from "../application/bearer.js";
import type { FailureLimiter, RateLimiter } from "../application/limiters.js";
import type { StorePort } from "../application/ports/store.js";
import type { Now } from "../application/read-model.js";
import { createWriteModel } from "../application/write-model.js";
import { clientAddress, forwardedProto } from "./client-address.js";
import {
  type Headers,
  JSON_MEDIA,
  NO_CONTENT,
  NO_STORE,
  type Reply,
  jsonReply,
  send,
  sha256,
} from "./http-security.js";
import {
  allowOf,
  isAdminWrite,
  type Route,
  type WriteRoute,
  writeRouteOf,
} from "./http-routes.js";

export const PUT_BODY_CAP = 1_048_576;
export const POST_BODY_CAP = 16_384;
export const ADMIN_LIMITER_KEY = "admin";
export const BEARER_REQUIRED = {
  "WWW-Authenticate": 'Bearer realm="waves"',
} as const;
export const RETRY_AFTER_ONE = { "Retry-After": "1" } as const;

/**
 * A body that was already being read and has to be abandoned: the answer closes
 * the connection, so Node does not drain what is left of it, but the socket is
 * not destroyed under the answer — the client is mid-body and needs to read it.
 */
const CONNECTION_CLOSE = { Connection: "close" } as const;

const ROTATE_QUERY = "rotate=1";

const PATH_MISMATCH: readonly ValidationIssue[] = [
  {
    path: "/project",
    message: "expected the project and wave the path names",
  },
];

export interface WriteDeps {
  readonly store: StorePort<Project, StoredSnapshot>;
  readonly now: Now;
  /** undefined leaves the admin routes disabled, so they answer 404. */
  readonly adminToken: string | undefined;
  readonly trustProxy: boolean;
  readonly compare: DigestComparer;
  readonly mintToken: () => string;
  readonly digestHex: (token: string) => string;
  readonly failures: FailureLimiter;
  readonly rate: RateLimiter;
}

export type WriteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  target: string,
  matched: Route,
) => Promise<number>;

/**
 * A refusal, and whether it was decided before the body was read. One that was
 * carries the socket with it, so Node never drains a body nobody will read.
 */
interface Refusal {
  readonly reply: Reply;
  readonly headers?: Headers;
  readonly preRead: boolean;
}

type Outcome = { readonly bytes: Buffer } | Refusal;

function refuse(reply: Reply, headers?: Headers): Refusal {
  return { reply, headers, preRead: true };
}

function afterRead(reply: Reply): Refusal {
  return { reply, preRead: false };
}

function isRefusal(outcome: Outcome | Digest): outcome is Refusal {
  return "reply" in outcome;
}

function queryOf(target: string): string {
  const cut = target.indexOf("?");
  return cut === -1 ? "" : target.slice(cut + 1);
}

function declaredLength(req: IncomingMessage): number {
  return Number(req.headers["content-length"] ?? "0");
}

/**
 * The declared media type, matched case-insensitively, with an optional charset
 * that has to be utf-8: this service parses JSON and nothing else, and a type it
 * did not expect is refused rather than guessed at. The syntax of the value has
 * already been checked by the parser, so what is left here is its meaning.
 */
function wantsJson(req: IncomingMessage): boolean {
  const raw = req.headers["content-type"];
  if (raw === undefined) {
    return false;
  }
  const cut = raw.indexOf(";");
  const media = (cut === -1 ? raw : raw.slice(0, cut)).trim().toLowerCase();
  if (media !== JSON_MEDIA) {
    return false;
  }
  const parameters = (cut === -1 ? "" : raw.slice(cut + 1))
    .split(";")
    .map((parameter) => parameter.trim().toLowerCase());
  const charset = parameters.find((parameter) =>
    parameter.startsWith("charset="),
  );
  return charset === undefined || charset === "charset=utf-8";
}

function framing(
  route: WriteRoute,
  req: IncomingMessage,
  cap: number,
): Refusal | undefined {
  if (route.kind === "drop" || route.kind === "removeProject") {
    if (
      declaredLength(req) !== 0 ||
      req.headers["transfer-encoding"] !== undefined
    ) {
      return refuse(jsonReply(400, { error: "a delete carries no body" }));
    }
    return undefined;
  }
  if (!wantsJson(req)) {
    return refuse(jsonReply(415, { error: "unsupported media type" }));
  }
  if (declaredLength(req) > cap) {
    return refuse(jsonReply(413, { error: "body too large" }));
  }
  return undefined;
}

/**
 * Reads at most `cap` bytes of the body and stops there. What arrives after the
 * cap is not drained: the read is abandoned, the rest stays on the socket, and
 * the connection is closed once the answer has flushed. This is what stops a
 * stream that never ends from tying up the process, whether it announced a
 * length or used chunked transfer-encoding.
 */
function readCapped(
  req: IncomingMessage,
  cap: number,
): Promise<Buffer | undefined> {
  return new Promise((settled) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let over = false;
    const finish = (): void => {
      req.off("data", onData);
      req.off("end", finish);
      req.off("error", finish);
      settled(over ? undefined : Buffer.concat(chunks));
    };
    const onData = (chunk: Buffer): void => {
      total += chunk.byteLength;
      if (total > cap) {
        over = true;
        req.pause();
        finish();
        return;
      }
      chunks.push(chunk);
    };
    req.on("data", onData);
    req.once("end", finish);
    req.once("error", finish);
  });
}

/** Strict UTF-8, then JSON. Anything either refuses is a 400. */
function decode(
  bytes: Buffer,
): { readonly ok: true; readonly value: unknown } | Refusal {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return refuse(jsonReply(400, { error: "not utf-8" }));
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return refuse(jsonReply(400, { error: "bad json" }));
  }
}

export function createWriteHandler(deps: WriteDeps): WriteHandler {
  const { store, now, adminToken, trustProxy, failures, rate } = deps;
  const model = createWriteModel({
    store,
    now,
    mintToken: deps.mintToken,
    digestHex: deps.digestHex,
  });
  const adminDigest = adminToken === undefined ? undefined : sha256(adminToken);
  const authenticate = createAuthenticator({ store, compare: deps.compare });

  const answer = (
    res: ServerResponse,
    method: string,
    socket: Socket,
    refusal: Refusal,
  ): number =>
    send(res, refusal.reply, {
      method,
      extra: { ...NO_STORE, ...refusal.headers },
      socket: refusal.preRead ? socket : undefined,
    });

  /** An authentication that did not succeed is a failure charged to the address. */
  const denied = (
    res: ServerResponse,
    method: string,
    socket: Socket,
    address: string,
    refusal: Refusal,
  ): number => {
    if (refusal.reply.status === 401 || refusal.reply.status === 403) {
      failures.fail(address);
    }
    return answer(res, method, socket, refusal);
  };

  async function readBody(req: IncomingMessage, cap: number): Promise<Outcome> {
    const bytes = await readCapped(req, cap);
    return bytes === undefined
      ? {
          reply: jsonReply(413, { error: "body too large" }),
          headers: CONNECTION_CLOSE,
          preRead: false,
        }
      : { bytes };
  }

  /**
   * The digest of the presented token, and every way it is refused. A duplicate
   * `Authorization` header is a request with two answers and is refused before
   * either is read; behind a trusted proxy a write has to have arrived as https;
   * a token outside this service's grammar never becomes a digest; and the admin
   * digest is compared in the same constant time as any project digest.
   */
  function digestOf(
    req: IncomingMessage,
    admin: Digest | undefined,
  ): Digest | Refusal {
    const presented = req.headersDistinct.authorization ?? [];
    if (presented.length > 1) {
      return refuse(jsonReply(400, { error: "more than one authorization" }));
    }
    if (trustProxy && forwardedProto(req) !== "https") {
      return refuse(jsonReply(403, { error: "https required" }));
    }
    const token = bearerToken(req.headers.authorization);
    if (token === undefined) {
      return refuse(jsonReply(401, { error: "unauthorized" }), BEARER_REQUIRED);
    }
    const digest = sha256(token);
    if (admin !== undefined && !matches(deps.compare, digest, admin)) {
      return refuse(jsonReply(401, { error: "unauthorized" }), BEARER_REQUIRED);
    }
    return digest;
  }

  /**
   * Which project a token belongs to: every stored digest is compared, not only
   * the one the path names, so a valid token for another project is a 403, an
   * unknown one a 401, and the time the answer took says nothing about which
   * projects exist or which one was meant.
   */
  async function authenticateWave(
    digest: Digest,
    project: string,
  ): Promise<Refusal | undefined> {
    const authenticated = await authenticate(digest, project);
    if (authenticated.kind === "accepted") {
      return undefined;
    }
    if (authenticated.kind === "unknown") {
      return refuse(jsonReply(401, { error: "unauthorized" }), BEARER_REQUIRED);
    }
    return refuse(jsonReply(403, { error: "wrong project" }));
  }

  async function register(
    res: ServerResponse,
    method: string,
    socket: Socket,
    req: IncomingMessage,
    rotate: boolean,
  ): Promise<number> {
    const body = await readBody(req, POST_BODY_CAP);
    if (isRefusal(body)) {
      return answer(res, method, socket, body);
    }
    const decoded = decode(body.bytes);
    if ("reply" in decoded) {
      return answer(res, method, socket, decoded);
    }
    const registration = await model.registerProject(decoded.value, rotate);
    if (registration.kind === "invalid") {
      return answer(
        res,
        method,
        socket,
        afterRead(jsonReply(422, { errors: registration.errors })),
      );
    }
    if (registration.kind === "conflict") {
      return answer(
        res,
        method,
        socket,
        afterRead(jsonReply(409, { error: "already registered" })),
      );
    }
    return answer(
      res,
      method,
      socket,
      afterRead(
        jsonReply(201, { id: registration.id, token: registration.token }),
      ),
    );
  }

  async function push(
    res: ServerResponse,
    method: string,
    socket: Socket,
    req: IncomingMessage,
    project: string,
    wave: string,
  ): Promise<number> {
    const body = await readBody(req, PUT_BODY_CAP);
    if (isRefusal(body)) {
      return answer(res, method, socket, body);
    }
    const decoded = decode(body.bytes);
    if ("reply" in decoded) {
      return answer(res, method, socket, decoded);
    }
    const validated = validateEnvelope(decoded.value);
    if (!validated.ok) {
      return answer(
        res,
        method,
        socket,
        afterRead(jsonReply(422, { errors: validated.errors })),
      );
    }
    if (validated.value.project !== project || validated.value.wave !== wave) {
      return answer(
        res,
        method,
        socket,
        afterRead(jsonReply(422, { errors: PATH_MISMATCH })),
      );
    }
    const stored = await model.putWave(project, validated.value);
    return answer(
      res,
      method,
      socket,
      afterRead(jsonReply(200, { receivedAt: stored.receivedAt })),
    );
  }

  /**
   * The write path, in the order the steps are documented. Everything refused
   * here is refused before the body is read, and therefore closes the
   * connection; the only reads of a body are in `push` and `register`, both of
   * which run after authentication has already answered.
   */
  return async (req, res, method, target, matched) => {
    const socket = req.socket;
    const address = clientAddress(req, trustProxy);
    const route = writeRouteOf(matched, method);
    if (route === undefined) {
      return matched.kind === "missing"
        ? answer(
            res,
            method,
            socket,
            refuse(jsonReply(404, { error: "not found" })),
          )
        : answer(
            res,
            method,
            socket,
            refuse(jsonReply(405, { error: "method not allowed" }), {
              Allow: allowOf(matched),
            }),
          );
    }
    if (isAdminWrite(route) && adminDigest === undefined) {
      // Disabled admin routes are gone rather than locked, so a probe cannot
      // tell one from a path that never existed.
      return answer(
        res,
        method,
        socket,
        refuse(jsonReply(404, { error: "not found" })),
      );
    }
    const query = queryOf(target);
    const rotate = query === ROTATE_QUERY;
    if (query !== "" && !(route.kind === "register" && rotate)) {
      return answer(
        res,
        method,
        socket,
        refuse(jsonReply(400, { error: "bad query" })),
      );
    }
    if (req.headers.origin !== undefined) {
      return answer(
        res,
        method,
        socket,
        refuse(jsonReply(403, { error: "cross-origin writes refused" })),
      );
    }
    const framed = framing(
      route,
      req,
      route.kind === "register" ? POST_BODY_CAP : PUT_BODY_CAP,
    );
    if (framed !== undefined) {
      return answer(res, method, socket, framed);
    }
    if (failures.lockedOut(address)) {
      return answer(
        res,
        method,
        socket,
        refuse(jsonReply(429, { error: "too many failures" })),
      );
    }
    const authenticated = digestOf(
      req,
      isAdminWrite(route) ? adminDigest : undefined,
    );
    if (isRefusal(authenticated)) {
      return denied(res, method, socket, address, authenticated);
    }
    if (route.kind === "push" || route.kind === "drop") {
      const wave = await authenticateWave(authenticated, route.project);
      if (wave !== undefined) {
        return denied(res, method, socket, address, wave);
      }
    }
    if (
      !rate.take(
        route.kind === "push" || route.kind === "drop"
          ? route.project
          : ADMIN_LIMITER_KEY,
      )
    ) {
      return answer(
        res,
        method,
        socket,
        refuse(jsonReply(429, { error: "too many writes" }), RETRY_AFTER_ONE),
      );
    }
    switch (route.kind) {
      case "register":
        return register(res, method, socket, req, rotate);
      case "removeProject":
        return answer(
          res,
          method,
          socket,
          afterRead(
            (await model.deleteProject(route.project))
              ? NO_CONTENT
              : jsonReply(404, { error: "not found" }),
          ),
        );
      case "drop":
        return answer(
          res,
          method,
          socket,
          afterRead(
            (await model.deleteWave(route.project, route.wave))
              ? NO_CONTENT
              : jsonReply(404, { error: "not found" }),
          ),
        );
      case "push":
        return push(res, method, socket, req, route.project, route.wave);
    }
  };
}
