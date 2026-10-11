import {
  answerChallengeText,
  MAX_SIGNED_ENTRIES_PER_DECISION,
  validateStoredStateEntry,
  type AnswerRequest,
} from "@hexagen-monaco/waves-contract";

import type { NonceStore } from "./nonce-store.js";
import type {
  NoticeStorePort,
  StoredDecision,
  StoredEntry,
} from "./ports/notice-store.js";
import type { AnswerVerifier } from "./ports/answer-verifier.js";
import type { Now } from "./read-model.js";

/** The one-way doors of design W68, checked before anything is signed. */
export type AnswerRefusal =
  "one-way-door" | "act-elsewhere" | "signed-cap" | "entry-ceiling";

export type AnswerOutcome =
  | { readonly kind: "stored"; readonly index: number; readonly state: string }
  | { readonly kind: "missing" }
  | { readonly kind: "not-verified" }
  | {
      readonly kind: "stale";
      readonly revision: number;
      readonly textSha256: string;
      readonly entries: number;
    }
  | { readonly kind: "refused"; readonly reason: AnswerRefusal }
  | { readonly kind: "internal" };

export interface AnswerModelDeps {
  /** Whether the project the route names is one this service holds. */
  readonly projectExists: (project: string) => Promise<boolean>;
  readonly noticeStore: NoticeStorePort;
  /** Only `consume`: the answer route spends a nonce, it never mints one. */
  readonly nonces: Pick<NonceStore, "consume">;
  readonly verify: AnswerVerifier;
  readonly now: Now;
  readonly log: (line: Record<string, unknown>) => void;
}

/** The same ISO text the notice write model writes, from the same clock. */
function timestampOf(atMs: number): string {
  return new Date(atMs).toISOString();
}

/** The three facts a stale answer is refused with: where the decision stands. */
function currentTrio(decision: StoredDecision): {
  revision: number;
  textSha256: string;
  entries: number;
} {
  const current = decision.revisions[decision.revisions.length - 1]!;
  return {
    revision: current.revision,
    textSha256: current.textSha256,
    entries: decision.entries.length,
  };
}

/**
 * The use case behind `POST /projects/:project/decisions/:decision/answer`
 * (design W61, W68): one signed answer, checked in the one order that makes
 * the refusal not an oracle. The body is the contract's validated answer
 * request; the model never re-validates bytes the contract already read.
 *
 * The nonce is spent before any check that can refuse, so every refusal
 * after it has burned the nonce: a replayed answer never gets far enough to
 * learn whether the first one was refused for being stale, one-way or
 * unsigned.
 */
export function createAnswerModel(deps: AnswerModelDeps) {
  const { projectExists, noticeStore, nonces, verify, now, log } = deps;

  return {
    async answer(
      project: string,
      decisionId: string,
      body: AnswerRequest,
    ): Promise<AnswerOutcome> {
      if (!(await projectExists(project))) {
        return { kind: "missing" };
      }
      const stored = await noticeStore.getDecision(project, decisionId);
      if (stored === undefined) {
        return { kind: "missing" };
      }
      const current = stored.revisions[stored.revisions.length - 1]!;

      // The nonce answers one attempt and is spent by it, whatever the
      // attempt ends in: every refusal below has already burned it.
      if (!nonces.consume(project, decisionId, body.nonce)) {
        return { kind: "not-verified" };
      }

      // Rule 2's pin, on the answer: the exact revision, the hash the server
      // itself stored on it, and the position the entry will take.
      const trio = currentTrio(stored);
      if (
        body.revision !== current.revision ||
        body.textSha256 !== current.textSha256 ||
        body.index !== stored.entries.length
      ) {
        return { kind: "stale", ...trio };
      }

      // W68: some decisions are not the owner's to answer, however well he
      // signs. Each door is its own refusal reason, in this order.
      const door = current.decision.hardToUndo.value;
      if (door === true || door === "partly") {
        return { kind: "refused", reason: "one-way-door" };
      }
      if (current.decision.actElsewhere !== undefined) {
        return { kind: "refused", reason: "act-elsewhere" };
      }
      const signed = stored.entries.filter(
        (one) => one.source === "signed",
      ).length;
      if (signed >= MAX_SIGNED_ENTRIES_PER_DECISION) {
        return { kind: "refused", reason: "signed-cap" };
      }

      // The challenge is rebuilt from what is stored, never from what the
      // body claims: the owner signed the server's own text.
      const challenge = answerChallengeText({
        project,
        decision: decisionId,
        textSha256: current.textSha256,
        index: stored.entries.length,
        verdict: body.verdict,
        option: body.option,
        words: body.words,
        nonce: body.nonce,
      });
      const verdict = verify(
        {
          credentialId: body.credentialId,
          authenticatorData: body.authenticatorData,
          clientDataJSON: body.clientDataJSON,
          signature: body.signature,
        },
        challenge,
      );
      if (!verdict.ok) {
        // The reason reaches the log and nothing else: the caller learns the
        // answer was not verified, never which check refused it.
        log({
          level: "warn",
          msg: "answer refused",
          project,
          decision: decisionId,
          reason: verdict.reason,
        });
        return { kind: "not-verified" };
      }

      const receivedAt = timestampOf(now());
      const storedEntry: StoredEntry = {
        index: stored.entries.length,
        receivedAt,
        state: body.verdict,
        source: "signed",
        revision: current.revision,
        textSha256: current.textSha256,
        by: verdict.label,
        at: receivedAt,
        ...(body.words !== undefined ? { words: body.words } : {}),
        ...(body.option !== undefined ? { option: body.option } : {}),
        signature: {
          credentialId: body.credentialId,
          authenticatorData: body.authenticatorData,
          clientDataJSON: body.clientDataJSON,
          signature: body.signature,
          nonce: body.nonce,
          index: stored.entries.length,
        },
      };
      // The entry is checked exactly as the file store's reader will see
      // it: without the `index` and `receivedAt` the store adds, so a label
      // the contract refuses is caught here, before anything is written.
      const { index: _index, receivedAt: _receivedAt, ...entry } = storedEntry;
      void _index;
      void _receivedAt;
      const validated = validateStoredStateEntry(entry);
      if (!validated.ok) {
        log({
          level: "error",
          msg: "answer entry failed validation",
          project,
          decision: decisionId,
          errors: validated.errors,
        });
        return { kind: "internal" };
      }

      const outcome = await noticeStore.appendEntry(
        project,
        decisionId,
        storedEntry,
        stored.entries.length,
        stored.revisions.length,
      );
      if (outcome === "missing") {
        return { kind: "missing" };
      }
      if (outcome === "ceiling") {
        return { kind: "refused", reason: "entry-ceiling" };
      }
      if (outcome === "conflict") {
        // The count moved between the read and the store's own compare; the
        // writer must re-read, so answer with what is stored now.
        const again = await noticeStore.getDecision(project, decisionId);
        if (again === undefined) {
          return { kind: "missing" };
        }
        return { kind: "stale", ...currentTrio(again) };
      }
      return {
        kind: "stored",
        index: storedEntry.index,
        state: body.verdict,
      };
    },
  };
}

export type AnswerModel = ReturnType<typeof createAnswerModel>;
