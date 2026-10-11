import { describe, expect, it } from "vitest";

import {
  answerChallengeText,
  MAX_SIGNED_ENTRIES_PER_DECISION,
  validateStoredStateEntry,
  type AnswerRequest,
} from "@hexagen-monaco/waves-contract";

import { MemoryStore } from "../src/index.js";
import type {
  AppendOutcome,
  NoticeStorePort,
  StoredEntry,
} from "../src/application/ports/notice-store.js";
import type {
  AnswerAssertion,
  AnswerVerifier,
} from "../src/application/ports/answer-verifier.js";
import {
  createAnswerModel,
  type AnswerOutcome,
} from "../src/application/answer-model.js";
import {
  decisionRevision,
  signedEntry,
  storedEntry,
  storedRevision,
} from "./notice-contract.js";

const PROJECT = "alpha";
const ID = "d1";
const NOW_MS = Date.parse("2026-10-08T14:00:00Z");
const RECEIVED = new Date(NOW_MS).toISOString();
const HASH = "0".repeat(64);
const OTHER_HASH = "1".repeat(64);
const NONCE = "A".repeat(43);
const LABEL = "owner key";
const BAD_SIGNATURE = "bad-signature";

/** A valid answer request pinned to revision 1's hash and the entry count. */
function answerBody(overrides: Partial<AnswerRequest> = {}): AnswerRequest {
  return {
    revision: 1,
    textSha256: HASH,
    index: 0,
    verdict: "approved",
    nonce: NONCE,
    credentialId: "c".repeat(20),
    authenticatorData: "d".repeat(52),
    clientDataJSON: "e".repeat(20),
    signature: "s".repeat(8),
    ...overrides,
  };
}

/** The stored entry the model's happy path should have written. */
function expectedEntry(
  index: number,
  body: AnswerRequest,
  overrides: Partial<StoredEntry> = {},
): StoredEntry {
  return {
    index,
    receivedAt: RECEIVED,
    state: body.verdict,
    source: "signed",
    revision: body.revision,
    textSha256: HASH,
    by: LABEL,
    at: RECEIVED,
    signature: {
      credentialId: body.credentialId,
      authenticatorData: body.authenticatorData,
      clientDataJSON: body.clientDataJSON,
      signature: body.signature,
      nonce: body.nonce,
      index,
    },
    ...overrides,
  };
}

interface Harness {
  readonly store: NoticeStorePort;
  readonly model: ReturnType<typeof createAnswerModel>;
  readonly verifyCalls: {
    readonly assertion: AnswerAssertion;
    readonly challenge: string;
  }[];
  readonly consumed: {
    readonly project: string;
    readonly decision: string;
    readonly nonce: string;
  }[];
  readonly logs: Record<string, unknown>[];
}

function harness(
  overrides: {
    store?: NoticeStorePort;
    verify?: AnswerVerifier;
    nonceOk?: boolean;
  } = {},
): Harness {
  const store = overrides.store ?? new MemoryStore();
  const verifyCalls: {
    assertion: AnswerAssertion;
    challenge: string;
  }[] = [];
  const consumed: {
    project: string;
    decision: string;
    nonce: string;
  }[] = [];
  const logs: Record<string, unknown>[] = [];
  const verifier: AnswerVerifier =
    overrides.verify ?? (() => ({ ok: true, label: LABEL }));
  const model = createAnswerModel({
    projectExists: (project) => Promise.resolve(project === PROJECT),
    noticeStore: store,
    nonces: {
      consume: (project, decision, nonce) => {
        consumed.push({ project, decision, nonce });
        return overrides.nonceOk ?? true;
      },
    },
    verify: (assertion, challenge) => {
      verifyCalls.push({ assertion, challenge });
      return verifier(assertion, challenge);
    },
    now: () => NOW_MS,
    log: (line) => {
      logs.push(line);
    },
  });
  return { store, model, verifyCalls, consumed, logs };
}

/** Raises decision `d1` with revision 1 and the given entries already on it. */
async function raised(
  store: NoticeStorePort,
  entries: readonly StoredEntry[] = [],
  revision = storedRevision(1, ID),
): Promise<void> {
  await store.appendRevision(PROJECT, ID, revision, 0, 3);
  for (const entry of entries) {
    const outcome = await store.appendEntry(PROJECT, ID, entry, entry.index, 1);
    expect(outcome).toBe("stored");
  }
}

/** A store that delegates everything but answers a fixed `appendEntry`. */
function withAppendOutcome(
  inner: NoticeStorePort,
  outcome: Exclude<AppendOutcome, "stored" | "conflict">,
): NoticeStorePort {
  return {
    getDecision: (p, i) => inner.getDecision(p, i),
    listDecisions: (p) => inner.listDecisions(p),
    appendRevision: (...args) => inner.appendRevision(...args),
    appendEntry: async () => outcome,
    appendEvent: (...args) => inner.appendEvent(...args),
    listEvents: (p, limit) => inner.listEvents(p, limit),
    deleteNotices: (p) => inner.deleteNotices(p),
  };
}

/** A store whose first `appendEntry` loses a race: another writer's entry
 * lands first, so the model's own append answers `conflict`. */
function racingStore(inner: NoticeStorePort): NoticeStorePort {
  let raced = false;
  return {
    getDecision: (p, i) => inner.getDecision(p, i),
    listDecisions: (p) => inner.listDecisions(p),
    appendRevision: (...args) => inner.appendRevision(...args),
    appendEntry: async (project, id, entry, expectEntries, expectRevisions) => {
      if (!raced) {
        raced = true;
        const other = await inner.appendEntry(
          project,
          id,
          storedEntry(expectEntries),
          expectEntries,
          expectRevisions,
        );
        expect(other).toBe("stored");
      }
      return inner.appendEntry(
        project,
        id,
        entry,
        expectEntries,
        expectRevisions,
      );
    },
    appendEvent: (...args) => inner.appendEvent(...args),
    listEvents: (p, limit) => inner.listEvents(p, limit),
    deleteNotices: (p) => inner.deleteNotices(p),
  };
}

/** A store whose first `appendEntry` answers `conflict` after the decision
 * is gone, so the model's re-read finds nothing. */
function vanishingStore(inner: NoticeStorePort): NoticeStorePort {
  let vanished = false;
  return {
    getDecision: async (p, i) => {
      if (vanished) {
        return undefined;
      }
      return inner.getDecision(p, i);
    },
    listDecisions: (p) => inner.listDecisions(p),
    appendRevision: (...args) => inner.appendRevision(...args),
    appendEntry: async (...args: unknown[]) => {
      void args;
      vanished = true;
      return "conflict" as const;
    },
    appendEvent: (...args) => inner.appendEvent(...args),
    listEvents: (p, limit) => inner.listEvents(p, limit),
    deleteNotices: (p) => inner.deleteNotices(p),
  };
}

/** The challenge text the model must have built: from the stored hash, the
 * entry count and the body's own words. */
function expectedChallenge(body: AnswerRequest, index = 0): string {
  return answerChallengeText({
    project: PROJECT,
    decision: ID,
    textSha256: HASH,
    index,
    verdict: body.verdict,
    option: body.option,
    words: body.words,
    nonce: body.nonce,
  });
}

/** Reads one decision's entry back and checks it as the store holds it. */
async function readBack(store: NoticeStorePort, index: number) {
  const decision = await store.getDecision(PROJECT, ID);
  const entry = decision?.entries[index];
  expect(entry).toBeDefined();
  const { index: _i, receivedAt: _r, ...stored } = entry!;
  void _i;
  void _r;
  const validated = validateStoredStateEntry(stored);
  expect(validated.ok).toBe(true);
  return entry!;
}

describe("the answer model", () => {
  describe("a good signature on a fresh pin is stored", () => {
    it.each([
      ["approved", answerBody()],
      ["declined", answerBody({ verdict: "declined" })],
      [
        "answered in words",
        answerBody({ verdict: "answered", words: "do it now" }),
      ],
      [
        "answered with an option",
        answerBody({ verdict: "answered", option: "b" }),
      ],
    ])("%s", async (_name, body) => {
      const h = harness();
      await raised(h.store);
      const outcome: AnswerOutcome = await h.model.answer(PROJECT, ID, body);
      expect(outcome).toEqual({
        kind: "stored",
        index: 0,
        state: body.verdict,
      });
      const entry = await readBack(h.store, 0);
      expect(entry.source).toBe("signed");
      expect(entry.by).toBe(LABEL);
      expect(entry.signature?.index).toBe(0);
      expect(entry).toEqual(
        expectedEntry(0, body, {
          ...(body.words !== undefined ? { words: body.words } : {}),
          ...(body.option !== undefined ? { option: body.option } : {}),
        }),
      );
      expect(h.consumed).toEqual([
        { project: PROJECT, decision: ID, nonce: NONCE },
      ]);
      expect(h.logs).toEqual([]);
    });
  });

  it("answers missing for an unknown project and does not spend a nonce", async () => {
    const h = harness();
    await raised(h.store);
    expect(await h.model.answer("beta", ID, answerBody())).toEqual({
      kind: "missing",
    });
    expect(await h.model.answer(PROJECT, "nope", answerBody())).toEqual({
      kind: "missing",
    });
    expect(h.consumed).toEqual([]);
    expect(h.verifyCalls).toEqual([]);
  });

  it("answers not-verified when the nonce is refused, before the signature is looked at", async () => {
    const h = harness({ nonceOk: false });
    await raised(h.store);
    expect(await h.model.answer(PROJECT, ID, answerBody())).toEqual({
      kind: "not-verified",
    });
    expect(h.verifyCalls).toEqual([]);
    expect((await h.store.getDecision(PROJECT, ID))?.entries).toEqual([]);
  });

  describe("a stale pin is refused with the current trio, after the nonce is burned", () => {
    it.each([
      ["revision", answerBody({ revision: 2 })],
      ["hash", answerBody({ textSha256: OTHER_HASH })],
      ["index", answerBody({ index: 5 })],
    ])("wrong %s", async (_name, body) => {
      const h = harness();
      await raised(h.store);
      expect(await h.model.answer(PROJECT, ID, body)).toEqual({
        kind: "stale",
        revision: 1,
        textSha256: HASH,
        entries: 0,
      });
      expect(h.consumed).toHaveLength(1);
      expect(h.verifyCalls).toEqual([]);
      expect((await h.store.getDecision(PROJECT, ID))?.entries).toEqual([]);
    });
  });

  describe("a one-way decision is refused before the signature is looked at", () => {
    it.each([
      [
        "one-way door true",
        "one-way-door",
        storedRevision(
          1,
          decisionRevision(ID, PROJECT, {
            hardToUndo: { value: true, reason: "the door is shut" },
          }),
        ),
      ],
      [
        "one-way door partly",
        "one-way-door",
        storedRevision(
          1,
          decisionRevision(ID, PROJECT, {
            hardToUndo: { value: "partly", reason: "half shut" },
          }),
        ),
      ],
      [
        "act elsewhere",
        "act-elsewhere",
        storedRevision(
          1,
          decisionRevision(ID, PROJECT, {
            actElsewhere: { where: "elsewhere", what: "a different thing" },
          }),
        ),
      ],
    ])("%s", async (_name, reason, revision) => {
      const h = harness();
      await raised(h.store, [], revision);
      expect(await h.model.answer(PROJECT, ID, answerBody())).toEqual({
        kind: "refused",
        reason,
      });
      expect(h.verifyCalls).toEqual([]);
      expect((await h.store.getDecision(PROJECT, ID))?.entries).toEqual([]);
    });

    it("refuses the 21st signed answer but stores the 20th", async () => {
      const full = harness();
      await raised(
        full.store,
        Array.from({ length: MAX_SIGNED_ENTRIES_PER_DECISION }, (_, i) =>
          signedEntry(i),
        ),
      );
      expect(
        await full.model.answer(
          PROJECT,
          ID,
          answerBody({ index: MAX_SIGNED_ENTRIES_PER_DECISION }),
        ),
      ).toEqual({ kind: "refused", reason: "signed-cap" });
      expect(full.verifyCalls).toEqual([]);
      expect((await full.store.getDecision(PROJECT, ID))?.entries).toHaveLength(
        MAX_SIGNED_ENTRIES_PER_DECISION,
      );

      const room = harness();
      await raised(
        room.store,
        Array.from({ length: MAX_SIGNED_ENTRIES_PER_DECISION - 1 }, (_, i) =>
          signedEntry(i),
        ),
      );
      expect(
        await room.model.answer(
          PROJECT,
          ID,
          answerBody({ index: MAX_SIGNED_ENTRIES_PER_DECISION - 1 }),
        ),
      ).toEqual({
        kind: "stored",
        index: MAX_SIGNED_ENTRIES_PER_DECISION - 1,
        state: "approved",
      });
    });
  });

  it("answers not-verified when the signature is bad, and the reason goes only to the log", async () => {
    const h = harness({
      verify: () => ({ ok: false, reason: BAD_SIGNATURE }),
    });
    await raised(h.store);
    const outcome = await h.model.answer(PROJECT, ID, answerBody());
    expect(outcome).toEqual({ kind: "not-verified" });
    expect(Object.keys(outcome)).toEqual(["kind"]);
    expect(h.logs).toEqual([
      {
        level: "warn",
        msg: "answer refused",
        project: PROJECT,
        decision: ID,
        reason: BAD_SIGNATURE,
      },
    ]);
    expect((await h.store.getDecision(PROJECT, ID))?.entries).toEqual([]);
  });

  it("builds the challenge from the stored hash and the entry count", async () => {
    const h = harness();
    await raised(
      h.store,
      [signedEntry(0)],
      storedRevision(1, decisionRevision(ID, PROJECT)),
    );
    const body = answerBody({ index: 1, verdict: "answered", option: "b" });
    expect(await h.model.answer(PROJECT, ID, body)).toEqual({
      kind: "stored",
      index: 1,
      state: "answered",
    });
    expect(h.verifyCalls).toHaveLength(1);
    expect(h.verifyCalls[0]!.assertion).toEqual({
      credentialId: body.credentialId,
      authenticatorData: body.authenticatorData,
      clientDataJSON: body.clientDataJSON,
      signature: body.signature,
    });
    expect(h.verifyCalls[0]!.challenge).toBe(expectedChallenge(body, 1));
  });

  describe("the store's own answer to the append", () => {
    it("answers stale with the new count when another writer landed first", async () => {
      const inner = new MemoryStore();
      const h = harness({ store: racingStore(inner) });
      await raised(h.store);
      expect(await h.model.answer(PROJECT, ID, answerBody())).toEqual({
        kind: "stale",
        revision: 1,
        textSha256: HASH,
        entries: 1,
      });
      expect((await inner.getDecision(PROJECT, ID))?.entries).toHaveLength(1);
    });

    it("answers missing when the decision is gone by the re-read", async () => {
      const h = harness({ store: vanishingStore(new MemoryStore()) });
      await raised(h.store);
      expect(await h.model.answer(PROJECT, ID, answerBody())).toEqual({
        kind: "missing",
      });
    });

    it("answers missing when the store says missing", async () => {
      const h = harness({
        store: withAppendOutcome(new MemoryStore(), "missing"),
      });
      await raised(h.store);
      expect(await h.model.answer(PROJECT, ID, answerBody())).toEqual({
        kind: "missing",
      });
    });

    it("refuses with entry-ceiling when the store says ceiling", async () => {
      const h = harness({
        store: withAppendOutcome(new MemoryStore(), "ceiling"),
      });
      await raised(h.store);
      expect(await h.model.answer(PROJECT, ID, answerBody())).toEqual({
        kind: "refused",
        reason: "entry-ceiling",
      });
    });
  });

  it("answers internal and stores nothing when the built entry fails the contract", async () => {
    const h = harness({
      verify: () => ({ ok: true, label: "" }),
    });
    await raised(h.store);
    expect(await h.model.answer(PROJECT, ID, answerBody())).toEqual({
      kind: "internal",
    });
    expect((await h.store.getDecision(PROJECT, ID))?.entries).toEqual([]);
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]!.level).toBe("error");
  });

  it("counts only signed entries against the cap when a session wrote over one", async () => {
    const h = harness();
    await raised(h.store, [
      ...Array.from({ length: MAX_SIGNED_ENTRIES_PER_DECISION - 1 }, (_, n) =>
        signedEntry(n),
      ),
      storedEntry(MAX_SIGNED_ENTRIES_PER_DECISION - 1, {
        state: "withdrawn",
        source: "session",
        reason: "pulled back",
      }),
    ]);
    expect(
      await h.model.answer(
        PROJECT,
        ID,
        answerBody({ index: MAX_SIGNED_ENTRIES_PER_DECISION }),
      ),
    ).toEqual({
      kind: "stored",
      index: MAX_SIGNED_ENTRIES_PER_DECISION,
      state: "approved",
    });
    const entry = await readBack(h.store, MAX_SIGNED_ENTRIES_PER_DECISION);
    expect(entry.signature?.index).toBe(MAX_SIGNED_ENTRIES_PER_DECISION);
  });

  it("refuses with signed-cap when the decision already holds the cap of signed entries", async () => {
    const h = harness();
    await raised(h.store, [
      ...Array.from({ length: MAX_SIGNED_ENTRIES_PER_DECISION }, (_, n) =>
        signedEntry(n),
      ),
      storedEntry(MAX_SIGNED_ENTRIES_PER_DECISION, {
        state: "withdrawn",
        source: "session",
        reason: "pulled back",
      }),
    ]);
    expect(
      await h.model.answer(
        PROJECT,
        ID,
        answerBody({ index: MAX_SIGNED_ENTRIES_PER_DECISION + 1 }),
      ),
    ).toEqual({ kind: "refused", reason: "signed-cap" });
    expect((await h.store.getDecision(PROJECT, ID))?.entries).toHaveLength(
      MAX_SIGNED_ENTRIES_PER_DECISION + 1,
    );
  });
});
