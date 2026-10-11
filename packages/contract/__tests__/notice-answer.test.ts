import { describe, expect, it } from "vitest";

import {
  answerChallengeText,
  type AnswerChallengeValues,
} from "../src/index.js";

const NONCE = "A".repeat(43);
const HASH = "0".repeat(64);

function values(): AnswerChallengeValues {
  return {
    project: "alpha",
    decision: "erase-user-prints-id",
    textSha256: HASH,
    index: 3,
    verdict: "answered",
    option: "b",
    words: "Go with b, the id appears once",
    nonce: NONCE,
  };
}

function expectedText(): string {
  return (
    '{"v":"waves-answer/v1","project":"alpha","decision":"erase-user-prints-id",' +
    `"textSha256":"${HASH}",` +
    '"index":3,"verdict":"answered","option":"b",' +
    '"words":"Go with b, the id appears once",' +
    `"nonce":"${NONCE}"}`
  );
}

describe("answerChallengeText", () => {
  it("the challenge text has its keys in the fixed order, whatever order the caller used", () => {
    expect(answerChallengeText(values())).toBe(expectedText());
    const reordered: AnswerChallengeValues = {
      nonce: NONCE,
      words: "Go with b, the id appears once",
      option: "b",
      verdict: "answered",
      index: 3,
      textSha256: HASH,
      decision: "erase-user-prints-id",
      project: "alpha",
    };
    expect(answerChallengeText(reordered)).toBe(expectedText());
  });

  it("an extra key on the caller's object does not reach the challenge text", () => {
    const withExtra = { ...values(), extra: "no", v: "waves-answer/v0" };
    expect(answerChallengeText(withExtra)).toBe(expectedText());
  });

  it("absent option and words are null in the challenge text", () => {
    const text = answerChallengeText({
      project: "alpha",
      decision: "d1",
      textSha256: HASH,
      index: 0,
      verdict: "approved",
      nonce: NONCE,
    });
    expect(text).toBe(
      '{"v":"waves-answer/v1","project":"alpha","decision":"d1",' +
        `"textSha256":"${HASH}",` +
        '"index":0,"verdict":"approved","option":null,"words":null,' +
        `"nonce":"${NONCE}"}`,
    );
  });

  it("escapes strings as JSON.stringify escapes them", () => {
    const text = answerChallengeText({
      ...values(),
      words: 'He said "b" — the id appears\nonce',
    });
    expect(text).toContain('"words":"He said \\"b\\" — the id appears\\nonce"');
  });

  it("two different sets of values never give the same text", () => {
    const base = answerChallengeText(values());
    const swapped = answerChallengeText({
      ...values(),
      project: "erase-user-prints-id",
      decision: "alpha",
    });
    expect(swapped).not.toBe(base);
    const moved = answerChallengeText({
      ...values(),
      option: "bb",
      words: "Go with , the id appears once",
    });
    expect(moved).not.toBe(base);
    const asString = answerChallengeText({
      ...values(),
      index: "1" as unknown as number,
    });
    expect(asString).not.toBe(answerChallengeText({ ...values(), index: 1 }));
  });

  it("no white space falls between the tokens", () => {
    expect(answerChallengeText(values())).not.toMatch(/[\n\t] /);
  });
});
