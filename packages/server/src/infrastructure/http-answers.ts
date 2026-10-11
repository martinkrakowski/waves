import type { IncomingMessage, ServerResponse } from "node:http";

import {
  validateAnswerRequest,
  type Project,
  type StoredSnapshot,
} from "@hexagen-monaco/waves-contract";

import {
  createAnswerModel,
  type AnswerRefusal,
} from "../application/answer-model.js";
import type { FailureLimiter, RateLimiter } from "../application/limiters.js";
import { createNonceStore } from "../application/nonce-store.js";
import type { NonceSource } from "../application/ports/nonce-source.js";
import type { NoticeStorePort } from "../application/ports/notice-store.js";
import type { StorePort } from "../application/ports/store.js";
import type { Now } from "../application/read-model.js";
import { EXPECTED_ORIGIN, verifyAssertion } from "./assertion-verifier.js";
import { clientAddress } from "./client-address.js";
import { jsonReply, NO_STORE, type Reply, send } from "./http-security.js";
import { queryOf, type Route } from "./http-routes.js";
import type { LoadedKey } from "./owner-keys-file.js";
import {
  decode,
  POST_BODY_CAP,
  readCapped,
  RETRY_AFTER_ONE,
  wantsJson,
} from "./http-write.js";

/**
 * The rate limiter's key for a nonce ask: the client address with a prefix a
 * project id cannot hold (an id has no colon), so a project pushing every
 * second and the owner asking for a nonce every second do not spend each
 * other's allowance.
 */
const NONCE_KEY_PREFIX = ":nonce:";

/** The answers route's own allowance key, apart from the nonce ask's. */
const ANSWER_KEY_PREFIX = ":answer:";

/** A refusal the model answered with goes out with the connection, because
 * the capped read was abandoned and the rest of the body has no reader. */
const CONNECTION_CLOSE = { Connection: "close" } as const;

/** A short sentence per refusal word, for the 409 body a caller can read. */
const REFUSAL_SENTENCES: Readonly<Record<AnswerRefusal, string>> = {
  "one-way-door": "the decision is a one-way door",
  "act-elsewhere": "the decision is acted on elsewhere",
  "signed-cap": "too many signed answers on this decision",
  "entry-ceiling": "too many entries on this decision",
};

const NOT_FOUND: Reply = jsonReply(404, { error: "not found" });

/**
 * The declared body size, or 0 when the request declared none. The number a
 * request writes about itself is all the framing this side reads before the
 * body: what actually arrives is decided by the capped read below.
 */
function declaredLength(req: IncomingMessage): number {
  return Number(req.headers["content-length"] ?? "0");
}

/** One refusal the handler answers after the body was read, socket kept. */
const TOO_LARGE: Reply = jsonReply(413, { error: "body too large" });

export interface AnswerDeps {
  readonly store: StorePort<Project, StoredSnapshot>;
  readonly noticeStore: NoticeStorePort;
  readonly now: Now;
  /** Where a nonce's bytes come from; the crypto adapter's `randomNonce` in production. */
  readonly nonceSource: NonceSource;
  /** The owner's public keys; the handler is reached only when they are loaded. */
  readonly ownerKeys: readonly LoadedKey[];
  /** The same sink as the access log: one JSON line per answer. */
  readonly log: (line: string) => void;
  /** The same instances the write handler holds: one lockout and one allowance per address. */
  readonly failures: FailureLimiter;
  readonly rate: RateLimiter;
  readonly trustProxy: boolean;
}

/** The two paths this handler serves, and no other route. */
export type AnswerRoute = Extract<
  Route,
  { readonly kind: "decisionNonce" | "decisionAnswers" }
>;

export type AnswerHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  matched: AnswerRoute,
) => Promise<number>;

/**
 * The routes a signed answer needs, which are the ones no token can serve:
 * the page itself asks them, and what it holds — the owner's assertion — is
 * the only credential. Neither route reads a bearer: an `Authorization`
 * header changes nothing, because no token is an answer. The read token a
 * deployment may configure is owed by both, but it is charged in the server
 * before this handler is reached, and it is a READ credential: it never
 * makes an answer accepted.
 *
 * The nonce ask carries no body, and an answers POST carries JSON only. It
 * is not the write pipeline either, because that refuses any `Origin` at all,
 * while this route's own page posts same-origin and arrives carrying
 * `Origin: https://waves.midnight.lan`, which is the one origin allowed
 * through. Everything refused here is refused before anything is read, so
 * each such refusal closes the connection rather than draining a body nobody
 * will look at.
 */
export function createAnswerHandler(deps: AnswerDeps): AnswerHandler {
  const { store, noticeStore, failures, rate, trustProxy, ownerKeys } = deps;
  const nonces = createNonceStore({
    now: deps.now,
    source: deps.nonceSource,
  });
  // The model the answers path runs: the same nonce store the nonce route
  // issues from, so a nonce is spent exactly where it was minted.
  const model = createAnswerModel({
    projectExists: async (project) =>
      (await store.getProject(project)) !== undefined,
    noticeStore,
    nonces,
    now: deps.now,
    verify: (assertion, text) => {
      const result = verifyAssertion(assertion, text, ownerKeys);
      return result.ok
        ? { ok: true, label: result.key.label }
        : { ok: false, reason: result.reason };
    },
    log: (line) => deps.log(JSON.stringify(line)),
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

  /** One answer after the body was read: the socket is kept for the client. */
  const respond = (
    req: IncomingMessage,
    res: ServerResponse,
    reply: Reply,
  ): number =>
    send(res, reply, {
      method: String(req.method),
      extra: NO_STORE,
    });

  /** A refusal the model answered with; every outcome maps to exactly one reply. */
  const answerReply = (
    req: IncomingMessage,
    res: ServerResponse,
    address: string,
    outcome: Awaited<ReturnType<typeof model.answer>>,
  ): number => {
    switch (outcome.kind) {
      case "stored":
        return respond(
          req,
          res,
          jsonReply(201, { index: outcome.index, state: outcome.state }),
        );
      case "missing":
        return respond(req, res, NOT_FOUND);
      case "not-verified":
        // The refusal is charged like a failed authentication, and the body
        // says only that the answer was not verified: the reason is in the log.
        failures.fail(address);
        return respond(
          req,
          res,
          jsonReply(403, { error: "not verified", reason: "not-verified" }),
        );
      case "stale":
        return respond(
          req,
          res,
          jsonReply(409, {
            error: "the decision changed",
            reason: "stale",
            revision: outcome.revision,
            textSha256: outcome.textSha256,
            entries: outcome.entries,
          }),
        );
      case "refused":
        return respond(
          req,
          res,
          jsonReply(409, {
            error: REFUSAL_SENTENCES[outcome.reason],
            reason: outcome.reason,
          }),
        );
      case "internal":
        return respond(req, res, jsonReply(500, { error: "internal" }));
    }
  };

  return async (req, res, matched) => {
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
    const address = clientAddress(req, trustProxy);

    if (matched.kind === "decisionNonce") {
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
      const decision = await noticeStore.getDecision(
        matched.project,
        matched.id,
      );
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
    }

    // The answers route. Every refusal below has burned the nonce already,
    // because the model spends it before any check that can refuse.
    if (failures.lockedOut(address)) {
      return refuse(req, res, jsonReply(429, { error: "too many failures" }));
    }
    if (!rate.take(`${ANSWER_KEY_PREFIX}${address}`)) {
      return refuse(
        req,
        res,
        jsonReply(429, { error: "too many writes" }),
        RETRY_AFTER_ONE,
      );
    }
    if (!wantsJson(req)) {
      return refuse(
        req,
        res,
        jsonReply(415, { error: "unsupported media type" }),
      );
    }
    if (declaredLength(req) > POST_BODY_CAP) {
      return refuse(req, res, TOO_LARGE);
    }
    const bytes = await readCapped(req, POST_BODY_CAP);
    if (bytes === undefined) {
      // The read was abandoned past the cap, so what is left of the body has
      // no reader: the connection goes with the answer.
      return send(res, TOO_LARGE, {
        method: String(req.method),
        extra: { ...NO_STORE, ...CONNECTION_CLOSE },
      });
    }
    const decoded = decode(bytes);
    if ("reply" in decoded) {
      return refuse(req, res, decoded.reply);
    }
    const validated = validateAnswerRequest(decoded.value);
    if (!validated.ok) {
      return respond(req, res, jsonReply(400, { errors: validated.errors }));
    }
    const outcome = await model.answer(
      matched.project,
      matched.id,
      validated.value,
    );
    return answerReply(req, res, address, outcome);
  };
}
