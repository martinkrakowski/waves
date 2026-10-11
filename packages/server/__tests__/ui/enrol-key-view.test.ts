import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { enrolKey } from "../../public/enrol-key.js";
import type { EnrolCredentials, EnrolState } from "../../public/enrol-key.js";
import { renderEnrolKey } from "../../public/views/enrol-key.js";

import {
  base64Of,
  base64urlOf,
  CREDENTIAL_ID,
  HOSTNAME,
  LOCATION,
  makeAssertion,
  makeCreation,
  makeCrypto,
  ORIGIN,
  SPKI,
} from "./enrol-key-fixtures.js";
import {
  assertNoInjectedMarkup,
  flush,
  freshRoot,
  tagsIn,
  textOf,
  textsOf,
} from "./helpers.js";

interface Credentials {
  create: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
}

/** A `credentials` whose `create` answers `response` and whose `get` asserts. */
function credentials(response: unknown, assertion?: unknown): Credentials {
  return {
    create: vi.fn().mockResolvedValue(response),
    get: vi.fn().mockResolvedValue(assertion),
  };
}

interface Page {
  readonly host: HTMLElement;
  /** Runs one press of the controller and draws what it answered. */
  press(kind: "onCreate" | "onVerify"): Promise<void>;
  readonly state: EnrolState;
}

/**
 * The page as the app draws it: a controller, the state it last answered with,
 * and a redraw after every press. It is the same wiring `createApp` does, so
 * what this draws is what the route draws.
 */
function openPage(creds: Credentials): Page {
  const controller = enrolKey(
    creds as unknown as EnrolCredentials,
    makeCrypto(0x41),
    LOCATION,
  );
  let state: EnrolState = controller.intro();
  const host = freshRoot();
  const run = async (step: () => Promise<EnrolState>): Promise<void> => {
    state = await step();
    host.replaceChildren(renderEnrolKey(state, handlers));
  };
  const handlers = {
    onCreate: () => {
      void run(() => controller.create());
    },
    onVerify: () => {
      void run(() => controller.test());
    },
  };
  host.replaceChildren(renderEnrolKey(state, handlers));
  return {
    host,
    press: async (kind) => {
      handlers[kind]();
      await flush();
      await flush();
      await flush();
    },
    get state() {
      return state;
    },
  };
}

/** Draws once and asserts the markup and text invariants every view owes. */
function settled(page: Page): HTMLElement {
  assertNoInjectedMarkup();
  for (const word of ["undefined", "null", "NaN", "Invalid Date"]) {
    expect(textOf(page.host)).not.toContain(word);
  }
  return page.host;
}

beforeEach(() => {
  // jsdom has no passkey of its own; every draw here is a browser that has one,
  // and the one test that wants the other answer says so itself.
  vi.stubGlobal("PublicKeyCredential", class {});
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const CREATE = "Create a passkey on this device";
const TEST = "Test: sign once with this passkey";

describe("renderEnrolKey", () => {
  it("shows the origin, the relying party id and that nothing is sent", () => {
    const host = settled(openPage(credentials(makeCreation())));

    expect(textsOf(host, "h1")).toStrictEqual(["Enrol an owner key"]);
    expect(textOf(host)).toContain(`Origin: ${ORIGIN}`);
    expect(textOf(host)).toContain(`Relying party id: ${HOSTNAME}`);
    expect(textOf(host)).toContain("This page sends nothing to the server");
  });

  it("offers the test button only after a good create", async () => {
    const page = openPage(credentials(makeCreation(), await makeAssertion()));

    expect(textsOf(page.host, "button")).toStrictEqual([CREATE]);
    await page.press("onCreate");
    expect(textsOf(page.host, "button")).toStrictEqual([TEST]);
  });

  it("shows the created key, the three flag lines and the line to copy", async () => {
    const page = openPage(
      credentials(makeCreation({ flagsByte: 0x45 }), await makeAssertion()),
    );
    await page.press("onCreate");
    const host = settled(page);

    expect(textsOf(host, "code")).toStrictEqual([
      base64urlOf(CREDENTIAL_ID),
      base64Of(SPKI),
      "-7",
      "not reported",
      "yes",
      "no",
      "no",
      `{"credentialId":"${base64urlOf(CREDENTIAL_ID)}","publicKeySpki":"${base64Of(SPKI)}","label":"","addedAt":"${/addedAt":"([^"]+)"/.exec(textOf(host))?.[1] ?? ""}"}`,
    ]);
    expect(textOf(host)).toContain("Can be synced to other devices");
    expect(textOf(host)).toContain("Is synced now (backed up)");
  });

  it("shows the two sync flags set for a passkey that reports them", async () => {
    const page = openPage(
      credentials(
        makeCreation({ flagsByte: 0x5d, transports: ["internal", "hybrid"] }),
        await makeAssertion(),
      ),
    );
    await page.press("onCreate");

    expect(textOf(page.host)).toContain("Transports: internal, hybrid");
    expect(textsOf(page.host, "code").slice(4, 7)).toStrictEqual([
      "yes",
      "yes",
      "yes",
    ]);
  });

  it("shows each refusal as one sentence, with no key beside it", async () => {
    for (const creation of [
      makeCreation({ getPublicKey: "missing" }),
      makeCreation({ getPublicKey: "null" }),
      makeCreation({ getPublicKey: "throw" }),
      makeCreation({ algorithm: -257 }),
      makeCreation({ flagsByte: 0x40 }),
    ]) {
      const page = openPage(credentials(creation));
      await page.press("onCreate");
      const host = settled(page);

      expect(textsOf(host, "code")).toStrictEqual([]);
      expect(textsOf(host, ".enrol-refused")).toHaveLength(1);
      // The button is offered again: he may try once more.
      expect(textsOf(host, "button")).toStrictEqual([CREATE]);
    }
  });

  it("says the refusal for a browser that returns no public key", async () => {
    const page = openPage(credentials(makeCreation({ getPublicKey: "null" })));
    await page.press("onCreate");

    expect(textOf(page.host.querySelector(".enrol-refused"))).toBe(
      "this browser does not return the public key; enrolment cannot be done here",
    );
  });

  it("shows a rejected create by its name and message", async () => {
    const page = openPage({
      create: vi.fn().mockRejectedValue(
        Object.assign(new Error("the operation was cancelled"), {
          name: "NotAllowedError",
        }),
      ),
      get: vi.fn(),
    });
    await page.press("onCreate");
    const host = settled(page);

    expect(textOf(host.querySelector(".enrol-refused"))).toBe(
      "NotAllowedError: the operation was cancelled",
    );
    expect(textsOf(host, "button")).toStrictEqual([CREATE]);
  });

  it("shows every check of a good test signature as ok", async () => {
    const page = openPage(credentials(makeCreation(), await makeAssertion()));
    await page.press("onCreate");
    await page.press("onVerify");
    const host = settled(page);

    expect(textsOf(host, ".enrol-check")).toStrictEqual([
      "credential id: ok",
      "client data: ok",
      "rpId hash: ok",
      "user verified: ok",
      "signature: ok",
    ]);
    expect(textsOf(host, ".enrol-check.fail")).toStrictEqual([]);
  });

  it("says which check failed when exactly one does", async () => {
    const creds = credentials(makeCreation(), await makeAssertion());
    const page = openPage(creds);
    await page.press("onCreate");
    creds.get.mockResolvedValue(
      await makeAssertion({ origin: "https://evil.example" }),
    );
    await page.press("onVerify");
    const host = settled(page);

    expect(textsOf(host, ".enrol-check.fail")).toStrictEqual([
      "client data: origin is https://evil.example",
    ]);
    expect(textsOf(host, ".enrol-check.ok")).toHaveLength(4);
  });

  it("holds no form, input, textarea or select", () => {
    const host = settled(openPage(credentials(makeCreation())));
    for (const tag of ["FORM", "INPUT", "TEXTAREA", "SELECT"]) {
      expect(tagsIn(host)).not.toContain(tag);
    }
  });

  it("says under the key what the key is, and what a synced passkey means", async () => {
    const page = openPage(credentials(makeCreation(), await makeAssertion()));
    await page.press("onCreate");
    const text = textOf(page.host.querySelector(".enrol-footer"));
    expect(text).toContain("public key");
    expect(text).toContain("copy it only from this screen");
    expect(text).toContain("/etc/waves/owner-keys.json");
    expect(text).toContain("fleet registry");
    expect(text).toContain("before pinning it");
  });

  it("reports a browser without PublicKeyCredential and offers no button", () => {
    vi.stubGlobal("PublicKeyCredential", undefined);
    try {
      const host = settled(openPage(credentials(makeCreation())));
      expect(textOf(host)).toContain("PublicKeyCredential is not available");
      expect(textsOf(host, "button")).toStrictEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps the page's own rpId and origin in the fields it draws", () => {
    const host = settled(openPage(credentials(makeCreation())));
    expect(textOf(host)).toContain(HOSTNAME);
    expect(textOf(host)).toContain(ORIGIN);
  });
});
