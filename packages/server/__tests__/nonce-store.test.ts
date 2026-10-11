import { describe, expect, it } from "vitest";

import {
  createNonceStore,
  MAX_NONCES,
  MAX_NONCES_PER_DECISION,
  NONCE_TTL_MS,
  type NonceStore,
} from "../src/application/nonce-store.js";

function clock(startAt = 0): {
  readonly now: () => number;
  readonly at: (ms: number) => void;
} {
  let at = startAt;
  return {
    now: () => at,
    at: (ms: number) => {
      at = ms;
    },
  };
}

/**
 * A nonce source that answers in the order it is asked, so a test never
 * depends on the bytes of a random value. The store only requires that two
 * answers differ, which a counter gives exactly.
 */
function counter(): () => string {
  let issued = 0;
  return () => `nonce-${(issued += 1)}`;
}

function store(time: { now: () => number }): NonceStore {
  return createNonceStore({ now: time.now, source: counter() });
}

/** Issues one nonce for one decision. */
function mint(subject: NonceStore, project = "alpha", decision = "d1"): string {
  return subject.issue(project, decision);
}

describe("createNonceStore", () => {
  it("answers the decision a nonce was issued for, once", () => {
    const subject = store(clock());
    const nonce = mint(subject);

    expect(subject.consume("alpha", "d1", nonce)).toBe(true);
    // Single use: the nonce is spent, and a second attempt is a miss.
    expect(subject.consume("alpha", "d1", nonce)).toBe(false);
  });

  it("refuses a nonce held for another decision, project, or none", () => {
    const subject = store(clock());
    const wrongDecision = mint(subject);
    expect(subject.consume("alpha", "d2", wrongDecision)).toBe(false);
    // The attempt spent the nonce, whatever it answered.
    expect(subject.consume("alpha", "d1", wrongDecision)).toBe(false);

    const wrongProject = mint(subject);
    expect(subject.consume("beta", "d1", wrongProject)).toBe(false);

    expect(subject.consume("alpha", "d1", "never-issued")).toBe(false);

    // The refusals were about the mismatch: a fresh nonce still answers.
    const fresh = mint(subject);
    expect(subject.consume("alpha", "d1", fresh)).toBe(true);
  });

  it("holds a nonce for exactly the ttl, and no longer", () => {
    // The edge chosen: a nonce is alive while it is strictly younger than
    // NONCE_TTL_MS, so at exactly 120 000 ms it is expired — on the consume
    // check below and on the sweep an issue makes.
    const time = clock();
    const subject = store(time);
    const young = mint(subject);
    const old = mint(subject);

    time.at(NONCE_TTL_MS - 1);
    expect(subject.consume("alpha", "d1", young)).toBe(true);
    time.at(NONCE_TTL_MS);
    expect(subject.consume("alpha", "d1", old)).toBe(false);
  });

  it("removes expired nonces on issue, so a cap never drops a live one", () => {
    // The clock moves backwards on purpose. The first nonce issued is the
    // oldest the per-decision cap could drop, but it was issued at a later
    // instant and is the only one still live when the fifth is asked for: if
    // the caps counted dead nonces, the live one would go instead.
    const time = clock(100_000);
    const subject = store(time);
    const oldest = mint(subject);

    time.at(0);
    const expiredSecond = mint(subject);
    const expiredThird = mint(subject);
    const expiredFourth = mint(subject);

    time.at(150_000);
    const fresh = mint(subject);

    expect(subject.consume("alpha", "d1", expiredSecond)).toBe(false);
    expect(subject.consume("alpha", "d1", expiredThird)).toBe(false);
    expect(subject.consume("alpha", "d1", expiredFourth)).toBe(false);
    // The oldest was kept: the dead ones made the room.
    expect(subject.consume("alpha", "d1", oldest)).toBe(true);
    expect(subject.consume("alpha", "d1", fresh)).toBe(true);
  });

  it("counts only live nonces at a cap", () => {
    // Four nonces for one decision have all expired; the decision is not
    // stuck at its cap by them, and four fresh ones all answer.
    const time = clock();
    const subject = store(time);
    for (let index = 0; index < MAX_NONCES_PER_DECISION; index += 1) {
      mint(subject);
    }

    time.at(NONCE_TTL_MS);
    const fresh: string[] = [];
    for (let index = 0; index < MAX_NONCES_PER_DECISION; index += 1) {
      fresh.push(mint(subject));
    }

    for (const nonce of fresh) {
      expect(subject.consume("alpha", "d1", nonce)).toBe(true);
    }
  });

  it("drops the oldest nonce in total at the total cap", () => {
    const subject = store(clock());
    // Sixteen decisions of four nonces each fill the total cap to the brim,
    // and every nonce is live. The first issued is the one the 65th must
    // spend; the rest are kept, each answerable for its own decision.
    const oldest = mint(subject, "alpha", "d0");
    const middle: string[] = [];
    for (let index = 1; index < MAX_NONCES; index += 1) {
      middle.push(
        mint(
          subject,
          "alpha",
          `d${Math.floor(index / MAX_NONCES_PER_DECISION)}`,
        ),
      );
    }
    const newcomer = mint(subject, "alpha", "fresh-decision");

    expect(subject.consume("alpha", "d0", oldest)).toBe(false);
    for (const [index, nonce] of middle.entries()) {
      expect(
        subject.consume(
          "alpha",
          `d${Math.floor((index + 1) / MAX_NONCES_PER_DECISION)}`,
          nonce,
        ),
      ).toBe(true);
    }
    expect(subject.consume("alpha", "fresh-decision", newcomer)).toBe(true);
  });

  it("drops only the decision's oldest at the per-decision cap", () => {
    const subject = store(clock());
    // Another decision's nonce sits in front, so dropping this decision's
    // oldest means walking past it and leaving it alone.
    const untouched = mint(subject, "alpha", "d1");
    const oldest = mint(subject, "alpha", "d2");
    const later: string[] = [];
    for (let index = 1; index < MAX_NONCES_PER_DECISION; index += 1) {
      later.push(mint(subject, "alpha", "d2"));
    }
    const fifth = mint(subject, "alpha", "d2");

    expect(subject.consume("alpha", "d2", oldest)).toBe(false);
    for (const nonce of later) {
      expect(subject.consume("alpha", "d2", nonce)).toBe(true);
    }
    expect(subject.consume("alpha", "d1", untouched)).toBe(true);
    expect(subject.consume("alpha", "d2", fifth)).toBe(true);
  });
});
