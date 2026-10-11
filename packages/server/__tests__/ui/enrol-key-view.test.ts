import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp, routeOf } from "../../public/app.js";
import type { EnrolCredentials, EnrolState } from "../../public/enrol-key.js";
import { enrolKey } from "../../public/enrol-key.js";
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
  publicKeyArgument,
  SPKI,
} from "./enrol-key-fixtures.js";
import { attentionView, NOW_MS, projectCard } from "./fixtures.js";
import {
  assertNoInjectedMarkup,
  browserGlobals,
  fetchStub,
  flush,
  freshRoot,
  textOf,
  textsOf,
  tagsIn,
} from "./helpers.js";

const CREATE = "Create a passkey on this device";
const TEST = "Test: sign once with this passkey";
const SENDS = "This page sends nothing to the server";
const NO_PK = "PublicKeyCredential is not available in this browser";

/**
 * A `credentials` whose `create` answers `response` and `get` answers
 * `assertion`, reading its options under `publicKey` and refusing anything
 * else with a `NotSupportedError`, as the browser does.
 */
function credentials(
  response: unknown,
  assertion?: unknown,
): {
  create: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
} {
  return {
    create: vi.fn().mockImplementation((options: unknown) => {
      publicKeyArgument(options);
      return Promise.resolve(response);
    }),
    get: vi.fn().mockImplementation((options: unknown) => {
      publicKeyArgument(options);
      return Promise.resolve(assertion);
    }),
  };
}

interface Page {
  readonly host: HTMLElement;
  press(kind: "onCreate" | "onVerify"): Promise<void>;
  readonly state: EnrolState;
}

/** The page in front of the controller: draws the state, calls the handlers. */
function openPage(creds: {
  create: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
}): Page {
  const controller = enrolKey(
    creds as unknown as EnrolCredentials,
    makeCrypto(0x41),
    LOCATION,
  );
  let state: EnrolState = controller.intro();
  const host = freshRoot();
  /**
   * The work the last press started, which `press` awaits rather than counting
   * ticks: a test signature runs WebCrypto digests and a verification, so the
   * number of turns the event loop takes is not the test's to know.
   */
  let pending: Promise<void> = Promise.resolve();
  async function draw(step: () => Promise<EnrolState>): Promise<void> {
    state = await step();
    host.replaceChildren(renderEnrolKey(state, handlers));
  }
  const handlers = {
    onCreate: () => {
      pending = draw(() => controller.create());
    },
    onVerify: () => {
      pending = draw(() => controller.test());
    },
  };
  host.replaceChildren(renderEnrolKey(state, handlers));
  return {
    host,
    press: async (kind) => {
      handlers[kind]();
      await pending;
    },
    get state() {
      return state;
    },
  };
}

/** Asserts the markup invariants and that no value leaked into the text. */
function settled(host: HTMLElement): HTMLElement {
  assertNoInjectedMarkup();
  expect(textOf(host)).not.toContain("undefined");
  expect(textOf(host)).not.toContain("null");
  expect(textOf(host)).not.toContain("NaN");
  return host;
}

describe("the /enrol-key route", () => {
  it("resolves /enrol-key at the enrol-key view and refuses paths under it", () => {
    expect(routeOf("/enrol-key")).toStrictEqual({ kind: "enrol-key" });
    expect(routeOf("/enrol-key/")).toStrictEqual({ kind: "unknown" });
    expect(routeOf("/enrol-key/x")).toStrictEqual({ kind: "unknown" });
  });
});

describe("renderEnrolKey", () => {
  beforeEach(() => {
    // jsdom has no passkey of its own; every draw here is a browser that has one,
    // and the one test that wants the other answer says so itself.
    vi.stubGlobal("PublicKeyCredential", class {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows the origin, the relying party id and that nothing is sent", () => {
    const host = settled(openPage(credentials(makeCreation())).host);
    expect(textsOf(host, "h1")).toStrictEqual(["Enrol an owner key"]);
    expect(textsOf(host, "code")).toStrictEqual([ORIGIN, HOSTNAME]);
    expect(textOf(host)).toContain(SENDS);
    expect(textsOf(host, "button")).toStrictEqual([CREATE]);
  });

  it("offers the test button only after a good create", async () => {
    const page = openPage(credentials(makeCreation(), await makeAssertion()));
    expect(textsOf(page.host, "button")).toStrictEqual([CREATE]);
    await page.press("onCreate");
    expect(textsOf(page.host, "button")).toStrictEqual([TEST]);
  });

  it.each([
    [0x45, ["yes", "no", "no"]],
    [0x4d, ["yes", "yes", "no"]],
    [0x5d, ["yes", "yes", "yes"]],
  ])(
    "shows the created key and the three flag lines for flags 0x%2x",
    async (flags, flagWords) => {
      const transports = flags === 0x5d ? ["internal", "hybrid"] : undefined;
      const page = openPage(
        credentials(
          makeCreation({ flagsByte: flags, transports }),
          await makeAssertion(),
        ),
      );
      await page.press("onCreate");
      const host = settled(page.host);

      expect(textsOf(host, "code")).toStrictEqual([
        base64urlOf(CREDENTIAL_ID),
        base64Of(SPKI),
        "-7",
        flags === 0x5d ? "internal, hybrid" : "not reported",
        ...flagWords,
        JSON.stringify({
          credentialId: base64urlOf(CREDENTIAL_ID),
          publicKeySpki: base64Of(SPKI),
          label: "",
          addedAt: /addedAt":"([^"]+)"/.exec(textOf(host))?.[1] ?? "",
        }),
      ]);
      expect(textOf(host)).toContain("Enrolment JSON");
      expect(textOf(host)).toContain("Can be synced to other devices");
      expect(textOf(host)).toContain("Is synced now (backed up)");
    },
  );

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
      const host = settled(page.host);

      expect(textsOf(host, "code")).toStrictEqual([]);
      expect(textsOf(host, ".enrol-refused")).toHaveLength(1);
      expect(textsOf(host, "button")).toStrictEqual([CREATE]);
    }
  });

  it("says why a create whose response has no public key was refused", async () => {
    const page = openPage(credentials(makeCreation({ getPublicKey: "null" })));
    await page.press("onCreate");
    expect(textOf(page.host.querySelector(".enrol-refused"))).toBe(
      "this browser does not return the public key; enrolment cannot be done here",
    );
  });

  it("shows a rejected create by its name and message, and offers the button again", async () => {
    const page = openPage({
      create: vi.fn().mockRejectedValue(
        Object.assign(new Error("the operation was cancelled"), {
          name: "NotAllowedError",
        }),
      ),
      get: vi.fn(),
    });
    await page.press("onCreate");
    const host = settled(page.host);

    expect(textOf(host.querySelector(".enrol-refused"))).toBe(
      "NotAllowedError: the operation was cancelled",
    );
    expect(textsOf(host, "button")).toStrictEqual([CREATE]);
  });

  it("shows every check of a good test signature as ok", async () => {
    const page = openPage(credentials(makeCreation(), await makeAssertion()));
    await page.press("onCreate");
    await page.press("onVerify");
    const host = settled(page.host);

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
    // Only the origin is wrong: the other four checks have to stay ok.
    creds.get.mockResolvedValue(
      await makeAssertion({ origin: "https://evil.example" }),
    );
    await page.press("onVerify");
    const host = settled(page.host);

    expect(textsOf(host, ".enrol-check.fail")).toStrictEqual([
      "client data: origin is https://evil.example",
    ]);
    expect(textsOf(host, ".enrol-check.ok")).toHaveLength(4);
  });

  it("says a failed check that carries no detail as failed, not as nothing", () => {
    const host = freshRoot();
    host.append(
      renderEnrolKey(
        {
          kind: "verified",
          checks: [{ label: "credential id", ok: false }],
          userVerified: true,
          backupEligible: false,
          backedUp: false,
        },
        { onCreate() {}, onVerify() {} },
      ),
    );
    const drawn = settled(host);

    expect(textsOf(drawn, ".enrol-check.fail")).toStrictEqual([
      "credential id: failed",
    ]);
  });

  it("holds no form, input, textarea or select", () => {
    const { host } = openPage(credentials(makeCreation()));
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
    const host = settled(openPage(credentials(makeCreation())).host);
    expect(textOf(host)).toContain(NO_PK);
    expect(textsOf(host, "button")).toStrictEqual([]);
  });

  it("keeps the page's own rpId and origin in the fields it draws", () => {
    const host = settled(openPage(credentials(makeCreation())).host);
    expect(textOf(host)).toContain(HOSTNAME);
    expect(textOf(host)).toContain(ORIGIN);
  });
});

describe("/enrol-key through the app", () => {
  it("draws the intro from the route, asking only the shell's own two reads", async () => {
    freshRoot();
    const browser = browserGlobals("/enrol-key");
    const projects = [projectCard()];
    const stub = fetchStub((path) =>
      path === "/api/v1/projects"
        ? { status: 200, body: projects }
        : path === "/api/v1/attention"
          ? { status: 200, body: attentionView() }
          : { status: 404 },
    );
    const creds = credentials(makeCreation(), await makeAssertion());
    const app = createApp({
      doc: document,
      location: browser.location,
      history: browser.history,
      win: browser.win,
      fetch: stub,
      credentials: creds as unknown as EnrolCredentials,
      crypto: makeCrypto(0x41),
      setTimer: () => 0,
      clearTimer: () => {},
      clock: () => NOW_MS,
      // No timer is armed by this test, so no refresh is due during it.
      refreshMs: 1_000_000,
    });
    app.start();
    await flush();
    await flush();

    expect(textsOf(document.body, "h1")).toContain("Enrol an owner key");
    expect(textOf(document.body)).toContain(SENDS);
    // The rail's two reads are the shell's own; nothing about the passkey is
    // asked of the API, and no credential was made to draw the intro.
    expect(stub.calls).toStrictEqual(["/api/v1/projects", "/api/v1/attention"]);
    expect(creds.create).not.toHaveBeenCalled();
  });
});
