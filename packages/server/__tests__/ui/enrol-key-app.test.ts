import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppGlobals } from "../../public/app.js";
import { createApp } from "../../public/app.js";

import {
  base64Of,
  base64urlOf,
  CREDENTIAL_ID,
  HOSTNAME,
  makeAssertion,
  makeCreation,
  makeCrypto,
  ORIGIN,
  SPKI,
} from "./enrol-key-fixtures.js";
import { attentionView, NOW_MS, projectCard } from "./fixtures.js";
import type { FetchStub } from "./helpers.js";
import {
  browserGlobals,
  fetchStub,
  flush,
  freshRoot,
  gatedFetch,
  root,
  textOf,
  textsOf,
} from "./helpers.js";

const CREATE = "Create a passkey on this device";
const CREATE_ROAMING = "Create on a hardware security key";
const TEST = "Test: sign once with this passkey";
const NO_PK = "PublicKeyCredential is not available in this browser";

/** The origin this test's app runs at, whose hostname is the page's rpId. */
const APP_ORIGIN = ORIGIN;

/**
 * A `credentials` whose `create` answers `response` and `get` answers
 * `assertion`, reading its options under `publicKey`, as the browser does.
 */
function credentials(
  response: unknown,
  assertion?: unknown,
): {
  create: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
} {
  return {
    create: vi.fn().mockImplementation(() => Promise.resolve(response)),
    get: vi.fn().mockImplementation(() => Promise.resolve(assertion)),
  };
}

/** The shell's two reads, and nothing else, answered; every other path 404s. */
function shellFetch(projects: readonly unknown[] = [projectCard()]): FetchStub {
  return fetchStub((path) =>
    path === "/api/v1/projects"
      ? { status: 200, body: projects }
      : path === "/api/v1/attention"
        ? { status: 200, body: attentionView() }
        : { status: 404 },
  );
}

function harness(options: {
  pathname: string;
  origin?: string;
  fetchImpl?: FetchStub;
  creds?: { create: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> };
}): {
  readonly app: ReturnType<typeof createApp>;
  readonly browser: ReturnType<typeof browserGlobals>;
  readonly fetchImpl: FetchStub;
} {
  freshRoot();
  const browser = browserGlobals(
    options.pathname,
    "",
    options.origin ?? APP_ORIGIN,
  );
  const fetchImpl = options.fetchImpl ?? shellFetch();
  const app = createApp({
    doc: document,
    location: browser.location,
    history: browser.history,
    win: browser.win,
    fetch: fetchImpl,
    ...(options.creds === undefined
      ? {}
      : {
          credentials: options.creds as unknown as NonNullable<
            AppGlobals["credentials"]
          >,
        }),
    crypto: makeCrypto(0x41),
    setTimer: () => 0,
    clearTimer: () => {},
    clock: () => NOW_MS,
    refreshMs: 1_000_000,
  } satisfies AppGlobals);
  app.start();
  return { app, browser, fetchImpl };
}

/** Lets every press's WebCrypto work and every draw settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await flush();
  }
}

/** Presses the enrol page's own button with the given label, once. */
function press(label: string): void {
  const buttons = [...root().querySelectorAll("button.enrol-button")];
  const target = buttons.find((b) => b.textContent === label);
  expect(target).toBeDefined();
  target?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

/** The enrol page as the app drew it, the view the route renders into main. */
function enrolView(): HTMLElement {
  const main = root().querySelector("main");
  expect(main).not.toBeNull();
  return main as HTMLElement;
}

/** The create options the page handed to `credentials.create`, by call. */
function createOptionsOf(
  creds: { create: ReturnType<typeof vi.fn> },
  at: number,
): { authenticatorSelection: { authenticatorAttachment: string } } {
  const call = creds.create.mock.calls[at] as
    [options: { publicKey: unknown }] | undefined;
  expect(call).toBeDefined();
  return (
    call?.[0] as {
      publicKey: {
        authenticatorSelection: { authenticatorAttachment: string };
      };
    }
  ).publicKey;
}

describe("the /enrol-key route through the app", () => {
  beforeEach(() => {
    // jsdom has no passkey of its own; every test here but the last one is a
    // browser that has one, and that one says so itself.
    vi.stubGlobal("PublicKeyCredential", class {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it("draws the intro at /enrol-key: origin, relying party id, Create", async () => {
    const { app } = harness({
      pathname: "/enrol-key",
      creds: credentials(makeCreation()),
    });
    await settle();

    expect(app.route).toStrictEqual({ kind: "enrol-key" });
    const view = enrolView();
    expect(textsOf(view, "h1")).toContain("Enrol an owner key");
    expect(textsOf(view, "code")).toStrictEqual([APP_ORIGIN, HOSTNAME]);
    expect(textsOf(view, "button")).toStrictEqual([CREATE, CREATE_ROAMING]);
    app.stop();
  });

  it("creates a passkey, shows it, and a Test press verifies every check", async () => {
    const creds = credentials(makeCreation(), await makeAssertion());
    const { app } = harness({ pathname: "/enrol-key", creds });
    await settle();

    press(CREATE);
    await settle();
    expect(creds.create).toHaveBeenCalledTimes(1);
    expect(textsOf(enrolView(), "code")).toContain(base64urlOf(CREDENTIAL_ID));
    expect(textsOf(enrolView(), "code")).toContain(base64Of(SPKI));

    press(TEST);
    // The page verifies with real WebCrypto, which answers on its own thread
    // and not within a fixed number of turns: wait for the checks themselves.
    await vi.waitFor(() => {
      expect(textsOf(enrolView(), ".enrol-check")).toHaveLength(5);
    });
    expect(creds.get).toHaveBeenCalledTimes(1);
    expect(textsOf(enrolView(), ".enrol-check")).toStrictEqual([
      "credential id: ok",
      "client data: ok",
      "rpId hash: ok",
      "user verified: ok",
      "signature: ok",
    ]);
    expect(textsOf(enrolView(), ".enrol-check.fail")).toStrictEqual([]);
    app.stop();
  });

  it("asks the API for nothing of its own, before or after any press", async () => {
    const creds = credentials(makeCreation(), await makeAssertion());
    const enrol = harness({ pathname: "/enrol-key", creds });
    await settle();
    const introCalls = [...enrol.fetchImpl.calls];

    press(CREATE);
    await settle();
    press(TEST);
    await settle();
    expect(enrol.fetchImpl.calls).toStrictEqual(introCalls);
    enrol.app.stop();

    // The same reads are the shell's on /inbox; the enrol page asks for the
    // inbox's own read less, and nothing more.
    const inbox = harness({ pathname: "/inbox" });
    await settle();
    expect(introCalls).toStrictEqual(
      inbox.fetchImpl.calls.filter((path) => path !== "/api/v1/inbox"),
    );
    inbox.app.stop();
  });

  it("resets to the intro when the reader leaves and returns, either way round", async () => {
    const creds = credentials(makeCreation());
    const { app } = harness({ pathname: "/enrol-key", creds });
    await settle();
    press(CREATE);
    await settle();
    expect(textsOf(enrolView(), "code")).toContain(base64urlOf(CREDENTIAL_ID));

    app.navigate("/");
    await settle();
    app.navigate("/enrol-key");
    await settle();

    expect(textsOf(enrolView(), "h1")).toContain("Enrol an owner key");
    expect(textOf(enrolView())).not.toContain(base64urlOf(CREDENTIAL_ID));
    expect(textsOf(enrolView(), "button")).toStrictEqual([
      CREATE,
      CREATE_ROAMING,
    ]);
    expect(creds.create).toHaveBeenCalledTimes(1);
    app.stop();

    // The other side of the reset: arriving at the page from elsewhere also
    // starts from the intro, not from a key a previous visit left.
    const fresh = harness({ pathname: "/" });
    await settle();
    fresh.app.navigate("/enrol-key");
    await settle();
    expect(textsOf(enrolView(), "h1")).toContain("Enrol an owner key");
    expect(textsOf(enrolView(), "button")).toStrictEqual([
      CREATE,
      CREATE_ROAMING,
    ]);
    fresh.app.stop();
  });

  it("drops a load the reader has navigated away from, and draws the later route", async () => {
    const gated = gatedFetch((path) =>
      path === "/api/v1/projects"
        ? { status: 200, body: [projectCard()] }
        : path === "/api/v1/attention"
          ? { status: 200, body: attentionView() }
          : { status: 404 },
    );
    const { app } = harness({
      pathname: "/enrol-key",
      fetchImpl: gated,
      creds: credentials(makeCreation()),
    });
    // The shell's two reads are still held when the reader moves on; the pass
    // they were for is no longer the one on screen, and the new route asks for
    // its own reads, which are held too.
    app.navigate("/");
    await settle();
    // The pass the navigation started waits behind the one still in flight;
    // the later route is what is on screen while both are held.
    expect(app.route).toStrictEqual({ kind: "projects" });
    expect(textOf(document.body)).not.toContain("Enrol an owner key");

    gated.release();
    await settle();
    gated.release();
    await settle();

    // The stale pass answered undefined and drew nothing; the later route is
    // still what is on screen, and nothing threw on the way there.
    expect(app.route).toStrictEqual({ kind: "projects" });
    expect(textOf(document.body)).not.toContain("Enrol an owner key");
    app.stop();
  });

  it("drops an answer that arrives after the reader left the page", async () => {
    let release: (value: unknown) => void = () => {};
    const gated = new Promise((resolve) => {
      release = resolve;
    });
    const creds = {
      create: vi
        .fn()
        .mockImplementation(() =>
          gated.then(() => Promise.resolve(makeCreation())),
        ),
      get: vi.fn(),
    };
    const { app } = harness({ pathname: "/enrol-key", creds });
    await settle();

    press(CREATE);
    expect(creds.create).toHaveBeenCalledTimes(1);
    app.navigate("/");
    await settle();
    app.navigate("/enrol-key");
    await settle();
    release(undefined);
    await flush();
    await settle();

    app.navigate("/enrol-key");
    await settle();
    expect(textsOf(enrolView(), "h1")).toContain("Enrol an owner key");
    expect(textOf(enrolView())).not.toContain(base64urlOf(CREDENTIAL_ID));
    expect(textsOf(enrolView(), "button")).toStrictEqual([
      CREATE,
      CREATE_ROAMING,
    ]);
    app.stop();
  });

  it("says passkeys are not available when the browser has none", async () => {
    vi.stubGlobal("PublicKeyCredential", undefined);
    const { app } = harness({ pathname: "/enrol-key" });
    await settle();

    expect(textOf(enrolView())).toContain(NO_PK);
    expect(root().querySelectorAll("button.enrol-button")).toHaveLength(0);
    app.stop();
  });

  it("offers each attachment exactly as its button names it", async () => {
    const creds = credentials(makeCreation());
    const { app } = harness({ pathname: "/enrol-key", creds });
    await settle();

    press(CREATE);
    await settle();
    expect(creds.create).toHaveBeenCalledTimes(1);
    expect(
      createOptionsOf(creds, 0).authenticatorSelection.authenticatorAttachment,
    ).toBe("platform");

    app.navigate("/");
    await settle();
    app.navigate("/enrol-key");
    await settle();
    press(CREATE_ROAMING);
    await settle();
    expect(creds.create).toHaveBeenCalledTimes(2);
    expect(
      createOptionsOf(creds, 1).authenticatorSelection.authenticatorAttachment,
    ).toBe("cross-platform");
    app.stop();
  });
});
