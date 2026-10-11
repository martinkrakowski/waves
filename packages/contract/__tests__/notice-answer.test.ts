import { describe, expect, it } from "vitest";

import {
  answerChallengeText,
  validateAnswerRequest,
  type AnswerChallengeValues,
  type AnswerRequest,
} from "../src/index.js";
import { errorsOf } from "./support.js";

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

const CREDENTIAL_ID = "A".repeat(16);
const AUTHENTICATOR_DATA = "B".repeat(50);
const CLIENT_DATA = "C".repeat(20);
const SIGNATURE = "D".repeat(8);

function minimalAnswer(): Record<string, unknown> {
  return {
    revision: 1,
    textSha256: HASH,
    index: 0,
    verdict: "approved",
    nonce: NONCE,
    credentialId: CREDENTIAL_ID,
    authenticatorData: AUTHENTICATOR_DATA,
    clientDataJSON: CLIENT_DATA,
    signature: SIGNATURE,
  };
}

function expectValidAnswer(input: unknown): AnswerRequest {
  const result = validateAnswerRequest(input);
  if (!result.ok) {
    throw new Error(
      `expected a valid answer, got ${JSON.stringify(result.errors)}`,
    );
  }
  return result.value;
}

function answerPaths(input: unknown, expected: readonly string[]): void {
  expect(errorsOf(validateAnswerRequest(input)).map((e) => e.path)).toEqual(
    expected,
  );
}

describe("validateAnswerRequest", () => {
  it("accepts an approved answer with neither option nor words", () => {
    expect(expectValidAnswer(minimalAnswer()).verdict).toBe("approved");
  });

  it("accepts a declined answer and an answered answer with words", () => {
    expect(
      expectValidAnswer({ ...minimalAnswer(), verdict: "declined" }).verdict,
    ).toBe("declined");
    expect(
      expectValidAnswer({
        ...minimalAnswer(),
        verdict: "answered",
        words: "go with b",
      }).words,
    ).toBe("go with b");
  });

  it("accepts an answered answer with an option", () => {
    expect(
      expectValidAnswer({
        ...minimalAnswer(),
        verdict: "answered",
        option: "b",
      }).option,
    ).toBe("b");
  });

  it("refuses a non-object root", () => {
    answerPaths("answer", [""]);
  });

  it("refuses an input that is not serialisable", () => {
    answerPaths({ ...minimalAnswer(), big: 1n }, [""]);
  });

  it("refuses an unknown key", () => {
    answerPaths({ ...minimalAnswer(), project: "alpha" }, ["/project"]);
  });

  it("bounds revision to an integer of at least 1", () => {
    answerPaths({ ...minimalAnswer(), revision: 0 }, ["/revision"]);
    answerPaths({ ...minimalAnswer(), revision: 1.5 }, ["/revision"]);
    expect(
      expectValidAnswer({ ...minimalAnswer(), revision: 1 }).revision,
    ).toBe(1);
  });

  it("bounds textSha256 to 64 lower-case hex characters", () => {
    answerPaths({ ...minimalAnswer(), textSha256: "0".repeat(63) }, [
      "/textSha256",
    ]);
    answerPaths({ ...minimalAnswer(), textSha256: "A".repeat(64) }, [
      "/textSha256",
    ]);
    expect(
      expectValidAnswer({ ...minimalAnswer(), textSha256: HASH }).textSha256,
    ).toBe(HASH);
  });

  it("bounds index to an integer of at least 0", () => {
    answerPaths({ ...minimalAnswer(), index: -1 }, ["/index"]);
    answerPaths({ ...minimalAnswer(), index: 0.5 }, ["/index"]);
    expect(expectValidAnswer({ ...minimalAnswer(), index: 0 }).index).toBe(0);
  });

  it("refuses a verdict outside the three answers", () => {
    answerPaths({ ...minimalAnswer(), verdict: "open" }, ["/verdict"]);
    answerPaths({ ...minimalAnswer(), verdict: "withdrawn" }, ["/verdict"]);
  });

  it("refuses an option that is not an option key", () => {
    answerPaths({ ...minimalAnswer(), option: "B" }, ["/option"]);
    answerPaths({ ...minimalAnswer(), option: "toolongkey" }, ["/option"]);
    expect(expectValidAnswer({ ...minimalAnswer(), option: "b2" }).option).toBe(
      "b2",
    );
  });

  it("refuses words that are not NFC notice text within its bound", () => {
    answerPaths({ ...minimalAnswer(), words: "" }, ["/words"]);
    answerPaths({ ...minimalAnswer(), words: "w".repeat(2001) }, ["/words"]);
    answerPaths({ ...minimalAnswer(), words: " words" }, ["/words"]);
    answerPaths({ ...minimalAnswer(), words: "words " }, ["/words"]);
    answerPaths({ ...minimalAnswer(), words: "cafe\u0301" }, ["/words"]);
    expect(
      expectValidAnswer({ ...minimalAnswer(), words: "w".repeat(2000) }).words,
    ).toBe("w".repeat(2000));
  });

  it("refuses an answered verdict with neither option nor words", () => {
    answerPaths({ ...minimalAnswer(), verdict: "answered" }, ["/verdict"]);
  });

  it("refuses an option on a declined verdict", () => {
    answerPaths({ ...minimalAnswer(), verdict: "declined", option: "b" }, [
      "/option",
    ]);
  });

  it("bounds the nonce to exactly 43 base64url characters", () => {
    answerPaths({ ...minimalAnswer(), nonce: "A".repeat(42) }, ["/nonce"]);
    answerPaths({ ...minimalAnswer(), nonce: "A".repeat(44) }, ["/nonce"]);
    expect(expectValidAnswer(minimalAnswer()).nonce).toBe(NONCE);
  });

  it("bounds credentialId to 16 to 1366 base64url characters", () => {
    answerPaths({ ...minimalAnswer(), credentialId: "A".repeat(15) }, [
      "/credentialId",
    ]);
    answerPaths({ ...minimalAnswer(), credentialId: "A".repeat(1367) }, [
      "/credentialId",
    ]);
    expect(
      expectValidAnswer({ ...minimalAnswer(), credentialId: "A".repeat(1366) })
        .credentialId,
    ).toHaveLength(1366);
    expect(
      expectValidAnswer({ ...minimalAnswer(), credentialId: "A".repeat(16) })
        .credentialId,
    ).toBe(CREDENTIAL_ID);
  });

  it("bounds authenticatorData to 50 to 1024 base64url characters", () => {
    answerPaths({ ...minimalAnswer(), authenticatorData: "B".repeat(49) }, [
      "/authenticatorData",
    ]);
    answerPaths({ ...minimalAnswer(), authenticatorData: "B".repeat(1025) }, [
      "/authenticatorData",
    ]);
    expect(
      expectValidAnswer({
        ...minimalAnswer(),
        authenticatorData: "B".repeat(50),
      }).authenticatorData,
    ).toBe(AUTHENTICATOR_DATA);
    expect(
      expectValidAnswer({
        ...minimalAnswer(),
        authenticatorData: "B".repeat(1024),
      }).authenticatorData,
    ).toHaveLength(1024);
  });

  it("bounds clientDataJSON to 20 to 2048 base64url characters", () => {
    answerPaths({ ...minimalAnswer(), clientDataJSON: "C".repeat(19) }, [
      "/clientDataJSON",
    ]);
    answerPaths({ ...minimalAnswer(), clientDataJSON: "C".repeat(2049) }, [
      "/clientDataJSON",
    ]);
    expect(
      expectValidAnswer({ ...minimalAnswer(), clientDataJSON: "C".repeat(20) })
        .clientDataJSON,
    ).toBe(CLIENT_DATA);
    expect(
      expectValidAnswer({
        ...minimalAnswer(),
        clientDataJSON: "C".repeat(2048),
      }).clientDataJSON,
    ).toHaveLength(2048);
  });

  it("bounds signature to 8 to 200 base64url characters", () => {
    answerPaths({ ...minimalAnswer(), signature: "D".repeat(7) }, [
      "/signature",
    ]);
    answerPaths({ ...minimalAnswer(), signature: "D".repeat(201) }, [
      "/signature",
    ]);
    expect(
      expectValidAnswer({ ...minimalAnswer(), signature: "D".repeat(8) })
        .signature,
    ).toBe(SIGNATURE);
    expect(
      expectValidAnswer({ ...minimalAnswer(), signature: "D".repeat(200) })
        .signature,
    ).toHaveLength(200);
  });

  it("refuses padding and the standard base64 alphabet in every byte string", () => {
    answerPaths({ ...minimalAnswer(), nonce: `${"A".repeat(42)}=` }, [
      "/nonce",
    ]);
    answerPaths({ ...minimalAnswer(), credentialId: "A".repeat(14) + "+" }, [
      "/credentialId",
    ]);
    answerPaths(
      { ...minimalAnswer(), authenticatorData: "B".repeat(49) + "/" },
      ["/authenticatorData"],
    );
    answerPaths({ ...minimalAnswer(), clientDataJSON: "C".repeat(19) + "=" }, [
      "/clientDataJSON",
    ]);
    answerPaths({ ...minimalAnswer(), signature: "D".repeat(9) + "+" }, [
      "/signature",
    ]);
    expect(expectValidAnswer(minimalAnswer()).credentialId).toBe(CREDENTIAL_ID);
  });

  it("names every path it refuses", () => {
    answerPaths(
      {
        ...minimalAnswer(),
        verdict: "answered",
        nonce: "A".repeat(42),
        signature: "D".repeat(7),
      },
      ["/nonce", "/signature", "/verdict"],
    );
  });
});
