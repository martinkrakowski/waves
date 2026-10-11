import { describe, expect, it } from "vitest";

import { validateOwnerKeys, type OwnerKeys } from "../src/index.js";
import { errorsOf } from "./support.js";

const CREDENTIAL_ID = "A".repeat(16);
const SPKI = "M".repeat(120) + "abcd";

function ownerKey(
  patch: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    credentialId: CREDENTIAL_ID,
    publicKeySpki: SPKI,
    label: "phone",
    addedAt: "2026-10-08T12:00:00Z",
    ...patch,
  };
}

function minimalKeys(
  patch: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema: "waves-owner-keys/v1",
    keys: [ownerKey()],
    ...patch,
  };
}

function expectValidKeys(input: unknown): OwnerKeys {
  const result = validateOwnerKeys(input);
  if (!result.ok) {
    throw new Error(
      `expected valid owner keys, got ${JSON.stringify(result.errors)}`,
    );
  }
  return result.value;
}

function keysPaths(input: unknown, expected: readonly string[]): void {
  expect(errorsOf(validateOwnerKeys(input)).map((e) => e.path)).toEqual(
    expected,
  );
}

describe("validateOwnerKeys", () => {
  it("accepts one key and keeps every field", () => {
    const document = expectValidKeys(minimalKeys());
    expect(document.schema).toBe("waves-owner-keys/v1");
    expect(document.keys).toEqual([ownerKey()]);
  });

  it("accepts a retired key and eight keys", () => {
    expect(
      expectValidKeys(minimalKeys({ keys: [ownerKey({ retired: true })] }))
        .keys[0]?.retired,
    ).toBe(true);
    const eight = Array.from({ length: 8 }, (_unused, index) =>
      ownerKey({ credentialId: `A${String(index).repeat(15)}` }),
    );
    expect(expectValidKeys(minimalKeys({ keys: eight })).keys).toHaveLength(8);
  });

  it("refuses a schema that is not waves-owner-keys/v1", () => {
    keysPaths(minimalKeys({ schema: "waves-owner-keys/v2" }), ["/schema"]);
    keysPaths(minimalKeys({ schema: 1 }), ["/schema"]);
  });

  it("refuses a non-object root and an input that is not serialisable", () => {
    keysPaths("keys", [""]);
    keysPaths({ ...minimalKeys(), big: 1n }, [""]);
  });

  it("refuses an unknown key at the top and in a key", () => {
    keysPaths(minimalKeys({ extra: true }), ["/extra"]);
    keysPaths(minimalKeys({ keys: [ownerKey({ privateKey: "no" })] }), [
      "/keys/0/privateKey",
    ]);
  });

  it("refuses keys that are not an array", () => {
    keysPaths(minimalKeys({ keys: "phone" }), ["/keys"]);
  });

  it("refuses a key that is not an object", () => {
    keysPaths(minimalKeys({ keys: ["phone"] }), ["/keys/0"]);
  });

  it("refuses an empty keys array", () => {
    keysPaths(minimalKeys({ keys: [] }), ["/keys"]);
  });

  it("refuses more than eight keys", () => {
    const nine = Array.from({ length: 9 }, () => ownerKey());
    keysPaths(minimalKeys({ keys: nine }), ["/keys"]);
  });

  it("bounds credentialId to 16 to 1366 base64url characters", () => {
    keysPaths(
      minimalKeys({ keys: [ownerKey({ credentialId: "A".repeat(15) })] }),
      ["/keys/0/credentialId"],
    );
    keysPaths(
      minimalKeys({ keys: [ownerKey({ credentialId: "A".repeat(1367) })] }),
      ["/keys/0/credentialId"],
    );
    expect(
      expectValidKeys(
        minimalKeys({ keys: [ownerKey({ credentialId: "A".repeat(1366) })] }),
      ).keys[0]?.credentialId,
    ).toHaveLength(1366);
    expect(
      expectValidKeys(
        minimalKeys({ keys: [ownerKey({ credentialId: "A".repeat(16) })] }),
      ).keys[0]?.credentialId,
    ).toBe(CREDENTIAL_ID);
  });

  it("refuses a credentialId that is not base64url", () => {
    keysPaths(
      minimalKeys({
        keys: [ownerKey({ credentialId: `${"A".repeat(14)}+/` })],
      }),
      ["/keys/0/credentialId"],
    );
    keysPaths(
      minimalKeys({ keys: [ownerKey({ credentialId: `${"A".repeat(15)}=` })] }),
      ["/keys/0/credentialId"],
    );
  });

  it("bounds publicKeySpki to 80 to 200 characters", () => {
    keysPaths(
      minimalKeys({ keys: [ownerKey({ publicKeySpki: "A".repeat(76) })] }),
      ["/keys/0/publicKeySpki"],
    );
    keysPaths(
      minimalKeys({ keys: [ownerKey({ publicKeySpki: "A".repeat(204) })] }),
      ["/keys/0/publicKeySpki"],
    );
    expect(
      expectValidKeys(
        minimalKeys({ keys: [ownerKey({ publicKeySpki: "A".repeat(80) })] }),
      ).keys[0]?.publicKeySpki,
    ).toHaveLength(80);
    expect(
      expectValidKeys(
        minimalKeys({ keys: [ownerKey({ publicKeySpki: "A".repeat(200) })] }),
      ).keys[0]?.publicKeySpki,
    ).toHaveLength(200);
  });

  it("accepts the standard base64 alphabet and its padding in publicKeySpki", () => {
    for (const spki of [
      `${"A".repeat(50)}+/${"A".repeat(66)}==`,
      `${"A".repeat(119)}=`,
    ]) {
      expect(
        expectValidKeys(
          minimalKeys({ keys: [ownerKey({ publicKeySpki: spki })] }),
        ).keys[0]?.publicKeySpki,
      ).toBe(spki);
    }
  });

  it("refuses a publicKeySpki outside the standard base64 alphabet", () => {
    keysPaths(
      minimalKeys({
        keys: [ownerKey({ publicKeySpki: `${"A".repeat(118)}_-=` })],
      }),
      ["/keys/0/publicKeySpki"],
    );
    keysPaths(
      minimalKeys({
        keys: [ownerKey({ publicKeySpki: `${"A".repeat(118)}===` })],
      }),
      ["/keys/0/publicKeySpki"],
    );
  });

  it("refuses a publicKeySpki missing the padding its length needs", () => {
    for (const spki of [
      "A".repeat(118),
      "A".repeat(119),
      `${"A".repeat(118)}=`,
      `${"A".repeat(119)}==`,
    ]) {
      keysPaths(minimalKeys({ keys: [ownerKey({ publicKeySpki: spki })] }), [
        "/keys/0/publicKeySpki",
      ]);
    }
  });

  it("refuses a length of 4n+1 and bits no byte uses", () => {
    for (const spki of [
      "A".repeat(121),
      `${"A".repeat(116)}AB==`,
      `${"A".repeat(117)}AB=`,
    ]) {
      keysPaths(minimalKeys({ keys: [ownerKey({ publicKeySpki: spki })] }), [
        "/keys/0/publicKeySpki",
      ]);
    }
  });

  it("accepts the canonical neighbour of every refused spelling", () => {
    for (const spki of [`${"A".repeat(116)}AA==`, `${"A".repeat(117)}AE=`]) {
      expect(
        expectValidKeys(
          minimalKeys({ keys: [ownerKey({ publicKeySpki: spki })] }),
        ).keys[0]?.publicKeySpki,
      ).toBe(spki);
    }
  });

  it("bounds label to 1 to 80 characters of NFC notice text", () => {
    keysPaths(minimalKeys({ keys: [ownerKey({ label: "" })] }), [
      "/keys/0/label",
    ]);
    keysPaths(minimalKeys({ keys: [ownerKey({ label: "l".repeat(81) })] }), [
      "/keys/0/label",
    ]);
    keysPaths(minimalKeys({ keys: [ownerKey({ label: " phone" })] }), [
      "/keys/0/label",
    ]);
    keysPaths(minimalKeys({ keys: [ownerKey({ label: "cafe\u0301" })] }), [
      "/keys/0/label",
    ]);
    expect(
      expectValidKeys(
        minimalKeys({ keys: [ownerKey({ label: "caf\u00e9" })] }),
      ).keys[0]?.label,
    ).toBe("caf\u00e9");
    keysPaths(minimalKeys({ keys: [ownerKey({ label: 7 })] }), [
      "/keys/0/label",
    ]);
    expect(
      expectValidKeys(
        minimalKeys({ keys: [ownerKey({ label: "l".repeat(80) })] }),
      ).keys[0]?.label,
    ).toHaveLength(80);
  });

  it("requires addedAt to be a UTC timestamp", () => {
    keysPaths(minimalKeys({ keys: [ownerKey({ addedAt: "2026-10-08" })] }), [
      "/keys/0/addedAt",
    ]);
    keysPaths(minimalKeys({ keys: [ownerKey({ addedAt: 7 })] }), [
      "/keys/0/addedAt",
    ]);
    expect(
      expectValidKeys(
        minimalKeys({
          keys: [ownerKey({ addedAt: "2026-10-08T12:00:00.250Z" })],
        }),
      ).keys[0]?.addedAt,
    ).toBe("2026-10-08T12:00:00.250Z");
  });

  it("refuses a retired that is not a boolean", () => {
    keysPaths(minimalKeys({ keys: [ownerKey({ retired: "yes" })] }), [
      "/keys/0/retired",
    ]);
  });

  it("refuses two keys with the same credential, naming the second", () => {
    keysPaths(
      minimalKeys({
        keys: [
          ownerKey(),
          ownerKey({ credentialId: "B".repeat(16) }),
          ownerKey(),
        ],
      }),
      ["/keys/2/credentialId"],
    );
    expect(
      expectValidKeys(
        minimalKeys({
          keys: [
            ownerKey(),
            ownerKey({ credentialId: "B".repeat(16), label: "laptop" }),
          ],
        }),
      ).keys,
    ).toHaveLength(2);
  });
});
