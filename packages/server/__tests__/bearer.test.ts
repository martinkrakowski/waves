import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  bearerToken,
  type Digest,
  createAuthenticator,
  hexToDigest,
  matches,
} from "../src/application/bearer.js";
import { MemoryStore } from "../src/infrastructure/memory-store.js";
import { digestsEqual, mintToken } from "../src/infrastructure/digest.js";

const TOKEN = "project-token-0123456789abcdefghijklmnopq";
const OTHER = "other-token-0123456789abcdefghijklmnopqr";

function digestOf(token: string): Digest {
  return createHash("sha256").update(token, "utf8").digest();
}

async function storeWith(
  entries: readonly (readonly [string, string])[],
): Promise<MemoryStore> {
  const store = new MemoryStore();
  for (const [id, token] of entries) {
    await store.putProject({
      id,
      name: id,
      tokenSha256: createHash("sha256").update(token, "utf8").digest("hex"),
      registeredAt: "2026-10-01T12:00:00Z",
    });
  }
  return store;
}

describe("bearerToken", () => {
  it("accepts the one spelling this service allows", () => {
    expect(bearerToken(`Bearer ${TOKEN}`)).toBe(TOKEN);
    expect(bearerToken(`Bearer ${"a".repeat(128)}`)).toBe("a".repeat(128));
  });

  it.each([
    ["nothing at all", undefined],
    ["another scheme", `Basic ${TOKEN}`],
    ["the scheme in lower case", `bearer ${TOKEN}`],
    ["no space at all", `Bearer${TOKEN}`],
    ["two spaces", `Bearer  ${TOKEN}`],
    ["a tab instead of a space", `Bearer\t${TOKEN}`],
    ["a token that is too short", `Bearer ${"a".repeat(31)}`],
    ["a token that is too long", `Bearer ${"a".repeat(129)}`],
    ["a character outside the grammar", `Bearer ${"a".repeat(31)}+`],
    ["a base64 padding character", `Bearer ${"a".repeat(31)}=`],
  ])("refuses %s", (_label, header) => {
    expect(bearerToken(header)).toBeUndefined();
  });
});

describe("digestsEqual", () => {
  it("is true for two digests of the same content", () => {
    expect(digestsEqual(digestOf(TOKEN), digestOf(TOKEN))).toBe(true);
  });

  it("is false for two digests of different content", () => {
    expect(digestsEqual(digestOf(TOKEN), digestOf(OTHER))).toBe(false);
  });

  it("refuses to compare digests of different lengths", () => {
    expect(() =>
      digestsEqual(digestOf(TOKEN), digestOf(TOKEN).subarray(0, 16)),
    ).toThrow(RangeError);
  });
});

describe("matches", () => {
  it("turns a refused comparison into a mismatch", () => {
    expect(
      matches(digestsEqual, digestOf(TOKEN), digestOf(TOKEN).subarray(0, 4)),
    ).toBe(false);
  });
});

describe("hexToDigest", () => {
  it("reads a digest into the bytes it is", () => {
    expect([...hexToDigest("00ff10")]).toEqual([0, 255, 16]);
  });

  it("reads a stored value that is not a digest as the wrong bytes, not as trust", () => {
    expect([...hexToDigest("zz")]).toEqual([0]);
    expect([...hexToDigest("00zz")]).toEqual([0, 0]);
    expect(hexToDigest("")).toHaveLength(0);
  });
});

describe("createAuthenticator", () => {
  it("accepts the token of the project the path names", async () => {
    const authenticate = createAuthenticator({
      store: await storeWith([["alpha", TOKEN]]),
      compare: digestsEqual,
    });

    await expect(authenticate(digestOf(TOKEN), "alpha")).resolves.toEqual({
      kind: "accepted",
      id: "alpha",
    });
  });

  it("says which project a token belongs to when it is another one", async () => {
    const authenticate = createAuthenticator({
      store: await storeWith([
        ["alpha", TOKEN],
        ["beta", OTHER],
      ]),
      compare: digestsEqual,
    });

    await expect(authenticate(digestOf(OTHER), "alpha")).resolves.toEqual({
      kind: "wrong-project",
      id: "beta",
    });
  });

  it("does not say a project exists when no token belongs to it", async () => {
    const authenticate = createAuthenticator({
      store: await storeWith([["alpha", TOKEN]]),
      compare: digestsEqual,
    });

    await expect(authenticate(digestOf(OTHER), "beta")).resolves.toEqual({
      kind: "unknown",
    });
  });

  it("compares every stored digest, and does not stop at the first match", async () => {
    const store = await storeWith([
      ["alpha", TOKEN],
      ["beta", TOKEN],
      ["gamma", OTHER],
    ]);
    const seen: string[] = [];
    const authenticate = createAuthenticator({
      store,
      compare: (presented, expected): boolean => {
        seen.push(Buffer.from(expected).toString("hex"));
        return digestsEqual(presented, expected);
      },
    });

    await expect(authenticate(digestOf(TOKEN), "alpha")).resolves.toEqual({
      kind: "accepted",
      id: "alpha",
    });
    expect(seen).toHaveLength(3);
  });

  it("does not compute anything when there is no token to compare", async () => {
    let calls = 0;
    const authenticate = createAuthenticator({
      store: await storeWith([["alpha", TOKEN]]),
      compare: (): boolean => {
        calls += 1;
        return true;
      },
    });

    await expect(authenticate(undefined, "alpha")).resolves.toEqual({
      kind: "unknown",
    });
    expect(calls).toBe(0);
  });

  it("treats a stored digest that is not one as a mismatch, not a crash", async () => {
    const store = new MemoryStore();
    await store.putProject({
      id: "alpha",
      name: "Alpha",
      tokenSha256: "not-a-digest",
      registeredAt: "2026-10-01T12:00:00Z",
    });
    const authenticate = createAuthenticator({
      store,
      compare: digestsEqual,
    });

    await expect(authenticate(digestOf(TOKEN), "alpha")).resolves.toEqual({
      kind: "unknown",
    });
  });

  it("accepts a match when no project was named at all", async () => {
    const authenticate = createAuthenticator({
      store: await storeWith([["alpha", TOKEN]]),
      compare: digestsEqual,
    });

    await expect(authenticate(digestOf(TOKEN))).resolves.toEqual({
      kind: "accepted",
      id: "alpha",
    });
  });
});

describe("mintToken", () => {
  it("mints 43 base64url characters, inside the token grammar", () => {
    const token = mintToken();

    expect(bearerToken(`Bearer ${token}`)).toBe(token);
    expect(mintToken()).not.toBe(token);
  });
});
