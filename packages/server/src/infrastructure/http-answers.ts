import type { IncomingMessage, ServerResponse } from "node:http";

import type { Project, StoredSnapshot } from "@hexagen-monaco/waves-contract";

import type { FailureLimiter, RateLimiter } from "../application/limiters.js";
import { createNonceStore } from "../application/nonce-store.js";
import type { NonceSource } from "../application/ports/nonce-source.js";
import type { NoticeStorePort } from "../application/ports/notice-store.js";
import type { StorePort } from "../application/ports/store.js";
import type { Now } from "../application/read-model.js";
import { EXPECTED_ORIGIN } from "./assertion-verifier.js";
import { clientAddress } from "./client-address.js";
import { jsonReply, NO_STORE, type Reply, send } from "./http-security.js";
import { queryOf, type Route } from "./http-routes.js";
import { RETRY_AFTER_ONE } from "./http-write.js";

/**
 * The rate limiter's key for a nonce ask: the client address with a prefix a
 * project id cannot hold (an id has no colon), so a project pushing every
 * second and the owner asking for a nonce every second do not spend each
 * other's allowance.
 */
const NONCE_KEY_PREFIX = ":nonce:";

const NOT_FOUND: Reply = jsonReply(404, { error: "not found" });

/**
 * The declared body size, or 0 when the request declared none. The number a
 * request writes about itself is all the framing this route reads: it never
 * reads the body, so what actually arrives is decided by the refusal below.
 */
function declaredLength(req: IncomingMessage): number {
  return Number(req.headers["content-length"] ?? "0");
}

export interface AnswerDeps {
  readonly store: StorePort<Project, StoredSnapshot>;
  readonly noticeStore: NoticeStorePort;
  readonly now: Now;
  /** Where a nonce's bytes come from; the crypto adapter's `randomNonce` in production. */
  readonly nonceSource: NonceSource;
  /** The same instances the write handler holds: one lockout and one allowance per address. */
  readonly failures: FailureLimiter;
  readonly rate: RateLimiter;
  readonly trustProxy: boolean;
}

export type AnswerHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  matched: Route,
) => Promise<number>;

/**
 * The routes a signed answer needs, which are the ones no token can serve:
 * the page itself asks them, and what it holds — the owner's assertion — is
 * the only credential. In this lane only the nonce route answers; the answers
 * path is routed but not served, and says `404 not found` until lane 3b
 * wires the assertion to it.
 *
 * The nonce ask carries no bearer, no cookie and no body, and an
 * `Authorization` header changes nothing: the handler never reads one. It is
 * not the write pipeline either, because that refuses any `Origin` at all,
 * while this route's own page posts same-origin and arrives carrying
 * `Origin: https://waves.midnight.lan`, which is the one origin allowed
 * through. Everything refused here is refused before anything is read, so
 * each refusal closes the connection rather than draining a body nobody will
 * look at.
 */
export function createAnswerHandler(deps: AnswerDeps): AnswerHandler {
  const { store, noticeStore, failures, rate, trustProxy } = deps;
  const nonces = createNonceStore({
    now: deps.now,
    source: deps.nonceSource,
  });

  /** One refusal, sent with the socket so a body still on its way is never drained. */
  const refuse = (
    req: IncomingMessage,
    res: ServerResponse,
    reply: Reply,
    headers?: Record<string, string>,
  ): number =>
    send(res, reply, {
      method: String(req.method),
      extra: { ...NO_STORE, ...headers },
      socket: req.socket,
    });

  return async (req, res, matched) => {
    if (matched.kind !== "decisionNonce") {
      // The answers path in this lane: routed, and answered as nothing yet.
      return refuse(req, res, NOT_FOUND);
    }
    if (queryOf(String(req.url)) !== "") {
      return refuse(req, res, jsonReply(400, { error: "bad query" }));
    }
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== EXPECTED_ORIGIN) {
      return refuse(
        req,
        res,
        jsonReply(403, { error: "cross-origin writes refused" }),
      );
    }
    if (
      declaredLength(req) !== 0 ||
      req.headers["transfer-encoding"] !== undefined
    ) {
      return refuse(
        req,
        res,
        jsonReply(400, { error: "a nonce request carries no body" }),
      );
    }
    const address = clientAddress(req, trustProxy);
    if (failures.lockedOut(address)) {
      return refuse(req, res, jsonReply(429, { error: "too many failures" }));
    }
    if (!rate.take(`${NONCE_KEY_PREFIX}${address}`)) {
      return refuse(
        req,
        res,
        jsonReply(429, { error: "too many writes" }),
        RETRY_AFTER_ONE,
      );
    }
    if ((await store.getProject(matched.project)) === undefined) {
      return refuse(req, res, NOT_FOUND);
    }
    const decision = await noticeStore.getDecision(matched.project, matched.id);
    if (decision === undefined) {
      return refuse(req, res, NOT_FOUND);
    }
    // The index the next state entry will take, beside the nonce the page
    // binds into its challenge: both together are all the answer says.
    const nonce = nonces.issue(matched.project, matched.id);
    return send(
      res,
      jsonReply(200, { nonce, index: decision.entries.length }),
      { method: String(req.method), extra: NO_STORE },
    );
  };
}
