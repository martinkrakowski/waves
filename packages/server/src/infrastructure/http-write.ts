import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";

import {
  validateEnvelope,
  validateStatus,
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
import {
  adminRouteEnabled,
  type Authorization,
  authorize,
  type TokenKind,
} from "../application/enrollment.js";
import type { FailureLimiter, RateLimiter } from "../application/limiters.js";
import type { StorePort } from "../application/ports/store.js";
import type { NoticeStorePort } from "../application/ports/notice-store.js";
import type { Now } from "../application/read-model.js";
import {
  createRegistrationGate,
  type RegistrationIdentity,
  sameRegistration,
} from "../application/registration-gate.js";
import {
  createNoticeWriteModel,
  type NoticeWriteModel,
} from "../application/notice-write-model.js";
import { eventReply, raiseReply, stateReply } from "./notice-replies.js";
import {
  createWriteModel,
  type Registration,
} from "../application/write-model.js";
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
// Neither key can be a project id (an id holds no colon), so neither token's
// allowance is ever shared with a project's pushes.
export const ADMIN_LIMITER_KEY = ":admin";
/**
 * The enrollment token's own allowance: the same one write a second as the
 * admin token's, kept apart from it, so a leaked enrollment token sending one
 * request a second cannot hold the admin token's rotations and removals — the
 * owner's way of cleaning up after it — at 429.
 */
export const ENROLL_LIMITER_KEY = ":enroll";
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
const EXPECT_100 = /(?:^|\W)100-continue(?:$|\W)/i;

const ENROLLMENT_REFUSAL = "enrollment token cannot do this";

const PATH_MISMATCH: readonly ValidationIssue[] = [
  {
    path: "/project",
    message: "expected the project and wave the path names",
  },
];

/**
 * The status names one project and no wave, so its mismatch is its own issue: the
 * same pointer as a push's, and a sentence that does not mention a wave the path
 * never had.
 */
const STATUS_PATH_MISMATCH: readonly ValidationIssue[] = [
  { path: "/project", message: "expected the project the path names" },
];

export interface WriteDeps {
  readonly store: StorePort<Project, StoredSnapshot>;
  readonly noticeStore: NoticeStorePort;
  readonly now: Now;
  /** The lower-case hex sha256 of a string; the notice model's hashText. */
  readonly hashText: (text: string) => string;
  /** undefined leaves the admin routes disabled, so they answer 404. */
  readonly adminToken: string | undefined;
  /** undefined leaves registration by enrollment token disabled, so it answers 404. */
  readonly enrollToken: string | undefined;
  /** The same sink as the access log: one JSON line per answer. */
  readonly log: (line: string) => void;
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

function isRefusal(
  outcome: Outcome | Digest | RegistrationIdentity,
): outcome is Refusal {
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
export function wantsJson(req: IncomingMessage): boolean {
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
export function readCapped(
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
export function decode(
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

/**
 * Tells a client that asked to wait that its body is welcome. Only now, after
 * the request has been authenticated and limited: a 100 sent earlier is a promise
 * to read a body this service is about to refuse, and a client that trusts it
 * sends a megabyte to a socket that is already closing.
 *
 * Only for HTTP/1.1, where the expectation is part of the protocol, and only for
 * the token `100-continue` itself: anything else in `Expect` is an extension this
 * service does not implement and must not be answered with a promise it will not
 * keep.
 */
function continueIfExpected(req: IncomingMessage, res: ServerResponse): void {
  if (req.httpVersion !== "1.1") {
    return;
  }
  const expected = req.headers.expect;
  if (expected === undefined || !EXPECT_100.test(expected)) {
    return;
  }
  res.writeContinue();
}

export function createWriteHandler(deps: WriteDeps): WriteHandler {
  const {
    store,
    noticeStore,
    now,
    hashText,
    adminToken,
    enrollToken,
    trustProxy,
    failures,
    rate,
  } = deps;
  const model = createWriteModel({
    store,
    noticeStore,
    now,
    mintToken: deps.mintToken,
    digestHex: deps.digestHex,
  });
  const noticeModel: NoticeWriteModel = createNoticeWriteModel({
    noticeStore,
    now,
    hashText,
  });
  const adminDigest = adminToken === undefined ? undefined : sha256(adminToken);
  const enrollDigest =
    enrollToken === undefined ? undefined : sha256(enrollToken);
  const authenticate = createAuthenticator({ store, compare: deps.compare });
  const gate = createRegistrationGate();

  /**
   * The answer a write whose registration is gone or is another's: the same
   * body and the same header as an unknown token's, sent after the body was
   * read.
   */
  const GONE: Refusal = {
    reply: jsonReply(401, { error: "unauthorized" }),
    headers: BEARER_REQUIRED,
    preRead: false,
  };

  /**
   * A project write runs only under the registration that authenticated it:
   * inside the gate the project is read again and its two registration fields
   * compared, so a delete, a re-registration or a rotation that committed after
   * the authentication turns the write into the answer an unknown token gets.
   * `undefined` means the registration that authenticated is gone.
   */
  function bound<T>(
    project: string,
    registration: RegistrationIdentity,
    write: () => Promise<T>,
  ): Promise<T | undefined> {
    return gate.exclusive(async () =>
      sameRegistration(await store.getProject(project), registration)
        ? write()
        : undefined,
    );
  }

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

  async function readBody(
    req: IncomingMessage,
    res: ServerResponse,
    cap: number,
  ): Promise<Outcome> {
    continueIfExpected(req, res);
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
   * The digest of the presented token, and every way it is refused before there
   * is one. A duplicate `Authorization` header is a request with two answers and
   * is refused before either is read; behind a trusted proxy a write has to
   * have arrived as https; and a token outside this service's grammar never
   * becomes a digest. What the digest is compared against is not decided here:
   * the two admin routes compare it against both of the service's own tokens,
   * and a wave against every stored project digest.
   */
  function digestOf(req: IncomingMessage): Digest | Refusal {
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
    return sha256(token);
  }

  /**
   * Which of the two service tokens the presented digest is. Both comparisons
   * are two statements, each guarded only by its own digest being configured, and
   * neither is skipped because the other matched: the time an answer takes then
   * depends on which tokens are configured and never on what was presented, so
   * it announces neither the tokens nor the one a caller guessed.
   */
  function kindOf(digest: Digest): TokenKind {
    const adminHit =
      adminDigest !== undefined && matches(deps.compare, digest, adminDigest);
    const enrollHit =
      enrollDigest !== undefined && matches(deps.compare, digest, enrollDigest);
    return adminHit ? "admin" : enrollHit ? "enroll" : "none";
  }

  /**
   * The two refusals the authorization table can answer, both charged to the
   * address's failure window: a token that is neither of this service's own is a
   * 401, and one that is the enrollment token on a route the enrollment token may
   * not use is a 403 that says so. Neither body carries anything the caller did
   * not already know.
   */
  function refused(
    decision: Extract<Authorization, { kind: "refuse" }>,
  ): Refusal {
    return decision.status === 401
      ? refuse(jsonReply(401, { error: "unauthorized" }), BEARER_REQUIRED)
      : refuse(jsonReply(403, { error: ENROLLMENT_REFUSAL }));
  }

  /**
   * The one answer per outcome of a registration, shared by the admin and the
   * enrollment dispatch: the four bodies a `POST /api/v1/projects` can end in,
   * whichever token asked. The `201` is the only place a token is ever returned.
   */
  function replyFor(registration: Registration): Reply {
    switch (registration.kind) {
      case "invalid":
        return jsonReply(422, { errors: registration.errors });
      case "conflict":
        return jsonReply(409, { error: "already registered" });
      case "ceiling":
        return jsonReply(403, { error: "enrollment ceiling reached" });
      case "registered":
        return jsonReply(201, {
          id: registration.id,
          token: registration.token,
        });
    }
  }

  /**
   * Which project a token belongs to: every stored digest is compared, not only
   * the one the path names, so a valid token for another project is a 403, an
   * unknown one a 401, and the time the answer took says nothing about which
   * projects exist or which one was meant. An accepted authentication also
   * hands back the registration that answered, which the write is then bound to.
   */
  async function authenticateWave(
    digest: Digest,
    project: string,
  ): Promise<Refusal | RegistrationIdentity> {
    const authenticated = await authenticate(digest, project);
    if (authenticated.kind === "accepted") {
      return authenticated.registration;
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
    power: "admin" | "enroll",
  ): Promise<number> {
    const body = await readBody(req, res, POST_BODY_CAP);
    if (isRefusal(body)) {
      return answer(res, method, socket, body);
    }
    const decoded = decode(body.bytes);
    if ("reply" in decoded) {
      return answer(res, method, socket, decoded);
    }
    // Both tokens read the body and the framing identically; they differ only in
    // what they may do with a free id, which is the model and not this pipeline.
    // The registry change runs inside the same gate a project write's compare
    // does, so nothing can register, rotate, enroll or remove between one.
    const registration = await gate.exclusive(() =>
      power === "admin"
        ? model.registerProject(decoded.value, rotate)
        : model.enrollProject(decoded.value),
    );
    // The answer goes out before anything else happens: it carries the only
    // copy of a new token there will ever be, and a log sink that throws must
    // not stand between the token and the client that asked for it.
    const sent = answer(res, method, socket, afterRead(replyFor(registration)));
    if (power === "enroll" && registration.kind === "registered") {
      // One line, so the owner can tell an enrolled project from a hand
      // registered one after the fact. The id, never the token or its digest.
      deps.log(
        JSON.stringify({
          ts: new Date(now()).toISOString(),
          event: "enrolled",
          project: registration.id,
        }),
      );
    }
    return sent;
  }

  async function push(
    res: ServerResponse,
    method: string,
    socket: Socket,
    req: IncomingMessage,
    project: string,
    wave: string,
    registration: RegistrationIdentity,
  ): Promise<number> {
    const body = await readBody(req, res, PUT_BODY_CAP);
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
    const stored = await bound(project, registration, () =>
      model.putWave(project, validated.value),
    );
    if (stored === undefined) {
      return answer(res, method, socket, GONE);
    }
    return answer(
      res,
      method,
      socket,
      afterRead(jsonReply(200, { receivedAt: stored.receivedAt })),
    );
  }

  /**
   * A project's status document, in the same order of checks and with the same
   * answer as a push, because it is the same write: the same project-token
   * authentication, the same per-project allowance, the same body cap, the same
   * decode, and the same two refusals after it — a document the contract refuses
   * with its own issues, and one whose `project` is not the path's.
   *
   * The cap is a push's rather than a registration's because a status is a
   * project-sized document like an envelope, not a body of three keys.
   */
  async function putStatus(
    res: ServerResponse,
    method: string,
    socket: Socket,
    req: IncomingMessage,
    project: string,
    registration: RegistrationIdentity,
  ): Promise<number> {
    const body = await readBody(req, res, PUT_BODY_CAP);
    if (isRefusal(body)) {
      return answer(res, method, socket, body);
    }
    const decoded = decode(body.bytes);
    if ("reply" in decoded) {
      return answer(res, method, socket, decoded);
    }
    const validated = validateStatus(decoded.value);
    if (!validated.ok) {
      return answer(
        res,
        method,
        socket,
        afterRead(jsonReply(422, { errors: validated.errors })),
      );
    }
    if (validated.value.project !== project) {
      return answer(
        res,
        method,
        socket,
        afterRead(jsonReply(422, { errors: STATUS_PATH_MISMATCH })),
      );
    }
    const stored = await bound(project, registration, () =>
      model.putStatus(project, validated.value),
    );
    if (stored === undefined) {
      return answer(res, method, socket, GONE);
    }
    return answer(
      res,
      method,
      socket,
      afterRead(jsonReply(200, { receivedAt: stored.receivedAt })),
    );
  }

  /**
   * `PUT …/decisions/<id>`: the contract's refusal, or the body's project and id
   * not matching the route, is a 400; a bound or a lost race is a 409 naming it;
   * a stored revision is a 200 with the revision, its hash, `created` and the
   * entry count the next state entry must pin on.
   */
  async function raiseDecision(
    res: ServerResponse,
    method: string,
    socket: Socket,
    req: IncomingMessage,
    project: string,
    id: string,
    registration: RegistrationIdentity,
  ): Promise<number> {
    const body = await readBody(req, res, PUT_BODY_CAP);
    if (isRefusal(body)) {
      return answer(res, method, socket, body);
    }
    const decoded = decode(body.bytes);
    if ("reply" in decoded) {
      return answer(res, method, socket, decoded);
    }
    const result = await bound(project, registration, () =>
      noticeModel.raiseDecision(project, id, decoded.value),
    );
    if (result === undefined) {
      return answer(res, method, socket, GONE);
    }
    return answer(res, method, socket, afterRead(raiseReply(result)));
  }

  /**
   * `POST …/decisions/<id>/states`: a 400 for the contract's refusals and the
   * option/supersededBy checks, a 404 for a missing decision, a 409 carrying the
   * current trio for a stale pin or a lost race, and a 201 with the entry index.
   */
  async function postState(
    res: ServerResponse,
    method: string,
    socket: Socket,
    req: IncomingMessage,
    project: string,
    id: string,
    registration: RegistrationIdentity,
  ): Promise<number> {
    const body = await readBody(req, res, POST_BODY_CAP);
    if (isRefusal(body)) {
      return answer(res, method, socket, body);
    }
    const decoded = decode(body.bytes);
    if ("reply" in decoded) {
      return answer(res, method, socket, decoded);
    }
    const result = await bound(project, registration, () =>
      noticeModel.postState(project, id, decoded.value),
    );
    if (result === undefined) {
      return answer(res, method, socket, GONE);
    }
    return answer(res, method, socket, afterRead(stateReply(result)));
  }

  /**
   * `POST …/events`: a 201 with the server-assigned id and the number of events
   * dropped past the keep cap.
   */
  async function postEvent(
    res: ServerResponse,
    method: string,
    socket: Socket,
    req: IncomingMessage,
    project: string,
    registration: RegistrationIdentity,
  ): Promise<number> {
    const body = await readBody(req, res, POST_BODY_CAP);
    if (isRefusal(body)) {
      return answer(res, method, socket, body);
    }
    const decoded = decode(body.bytes);
    if ("reply" in decoded) {
      return answer(res, method, socket, decoded);
    }
    const result = await bound(project, registration, () =>
      noticeModel.postEvent(project, decoded.value),
    );
    if (result === undefined) {
      return answer(res, method, socket, GONE);
    }
    return answer(res, method, socket, afterRead(eventReply(result)));
  }

  /**
   * The write path, in the order the steps are documented. Everything refused
   * here on the head alone is refused before the body is read, and therefore
   * closes the connection; the only reads of a body are in `push`, `putStatus`,
   * `register` and the three notice writes, all of which run after
   * authentication has already answered.
   *
   * A project-token write is bound to the registration that authenticated it:
   * after the body is read the project is read again and the two stored
   * registration fields compared, and a registration that is gone or different
   * answers exactly like an unknown token's. The registration gate is why
   * nothing can commit between that compare and the write: every registry
   * change — a registration, a rotation, an enrollment, a removal — runs inside
   * the same gate, so the compare and the store call are one exclusive step.
   * The answers route in `http-answers.ts`, the owner's signed answer, is not
   * a project-token write and is not bound here.
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
    const query = queryOf(target);
    const rotate = query === ROTATE_QUERY;
    if (
      isAdminWrite(route) &&
      !adminRouteEnabled(
        route.kind,
        rotate,
        adminDigest !== undefined,
        enrollDigest !== undefined,
      )
    ) {
      // Disabled admin routes are gone rather than locked, so a probe cannot
      // tell one from a path that never existed. `rotate` is read before this is
      // asked, because it is part of the question: a rotation and a removal are
      // admin-only whatever else is configured, so they are 404 while a plain
      // registration is not.
      return answer(
        res,
        method,
        socket,
        refuse(jsonReply(404, { error: "not found" })),
      );
    }
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
      route.kind === "register" ||
        route.kind === "postState" ||
        route.kind === "postEvent"
        ? POST_BODY_CAP
        : PUT_BODY_CAP,
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
    const authenticated = digestOf(req);
    if (isRefusal(authenticated)) {
      return denied(res, method, socket, address, authenticated);
    }
    if (isAdminWrite(route)) {
      // A rotation and a removal are the admin token's alone, so the two service
      // tokens resolve to a power and the table below turns that into an answer.
      // The handler does not check that the two configured tokens differ: it
      // cannot, and it does not have to — a test may hand it equal ones, and the
      // startup refusal in `main.ts` is what keeps that out of a deployment.
      const decision = authorize(route.kind, rotate, kindOf(authenticated));
      if (decision.kind === "refuse") {
        return denied(res, method, socket, address, refused(decision));
      }
      const power = decision.kind;
      if (
        !rate.take(power === "enroll" ? ENROLL_LIMITER_KEY : ADMIN_LIMITER_KEY)
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
          return register(res, method, socket, req, rotate, power);
        case "removeProject":
          return answer(
            res,
            method,
            socket,
            afterRead(
              (await gate.exclusive(() => model.deleteProject(route.project)))
                ? NO_CONTENT
                : jsonReply(404, { error: "not found" }),
            ),
          );
      }
    } else {
      const wave = await authenticateWave(authenticated, route.project);
      if (isRefusal(wave)) {
        return denied(res, method, socket, address, wave);
      }
      const registration = wave;
      /**
       * One allowance per project for both of the writes it makes, so a project's
       * push and its status share it: a status is one push a second, not a second
       * push a second, and a sender that spaces them or honours `Retry-After` is
       * never refused for saying two things about itself at once.
       */
      if (!rate.take(route.project)) {
        return answer(
          res,
          method,
          socket,
          refuse(jsonReply(429, { error: "too many writes" }), RETRY_AFTER_ONE),
        );
      }
      switch (route.kind) {
        case "drop": {
          const dropped = await bound(route.project, registration, () =>
            model.deleteWave(route.project, route.wave),
          );
          return dropped === undefined
            ? answer(res, method, socket, GONE)
            : answer(
                res,
                method,
                socket,
                afterRead(
                  dropped ? NO_CONTENT : jsonReply(404, { error: "not found" }),
                ),
              );
        }
        case "push":
          return push(
            res,
            method,
            socket,
            req,
            route.project,
            route.wave,
            registration,
          );
        case "putStatus":
          return putStatus(
            res,
            method,
            socket,
            req,
            route.project,
            registration,
          );
        case "raiseDecision":
          return raiseDecision(
            res,
            method,
            socket,
            req,
            route.project,
            route.id,
            registration,
          );
        case "postState":
          return postState(
            res,
            method,
            socket,
            req,
            route.project,
            route.id,
            registration,
          );
        case "postEvent":
          return postEvent(
            res,
            method,
            socket,
            req,
            route.project,
            registration,
          );
      }
    }
  };
}
