import { describe, expect, it } from "vitest";

import type { Command } from "../src/domain/args.js";
import { register } from "../src/application/register.js";
import type {
  HttpRequest,
  TransportOptions,
} from "../src/application/ports.js";
import {
  ADMIN_TOKEN,
  CONFIG_DIR,
  PROJECT,
  PROJECT_TOKEN,
  fakeFiles,
  harness,
  network,
  reply,
} from "./support/harness.js";

const tokenPath = `${CONFIG_DIR}/${PROJECT}.token`;

/** A readable admin token file, which every test past the token check needs. */
const ADMIN_FILE = {
  "/run/secrets/admin": { text: `${ADMIN_TOKEN}\n`, mode: 0o600 },
};

type RegisterCommand = Extract<Command, { readonly kind: "register" }>;

interface Sent {
  readonly options: TransportOptions;
  readonly request: HttpRequest;
}

function capturing(
  outcome: ReturnType<typeof reply>,
  adminFile?: { readonly text: string; readonly mode: number },
) {
  const sent: Sent[] = [];
  const built = harness({
    script: [outcome],
    files: adminFile === undefined ? {} : { "/run/secrets/admin": adminFile },
  });
  const deps = {
    ...built.deps,
    transport: (options: TransportOptions) => {
      return {
        send: async (request: HttpRequest) => {
          sent.push({ options, request });
          return outcome;
        },
      };
    },
  };
  return { sent, deps };
}

function command(overrides: Partial<RegisterCommand> = {}): RegisterCommand {
  return {
    kind: "register",
    id: PROJECT,
    name: "Waves Demo",
    rotate: false,
    adminToken: { kind: "file", path: "/run/secrets/admin" },
    ...overrides,
  };
}

describe("register", () => {
  it("sends the id, the name and the admin token", async () => {
    const created = reply(
      201,
      `{"id":"${PROJECT}","token":"${PROJECT_TOKEN}"}`,
    );
    const { sent, deps } = capturing(created, {
      text: `${ADMIN_TOKEN}\n`,
      mode: 0o600,
    });

    expect(await register(command(), deps)).toBe(0);
    expect(sent).toEqual([
      {
        options: {
          origin: "http://127.0.0.1:8080",
          ca: undefined,
          warnInsecure: undefined,
        },
        request: {
          method: "POST",
          url: "http://127.0.0.1:8080/api/v1/projects",
          bearer: ADMIN_TOKEN,
          body: `{"id":"${PROJECT}","name":"Waves Demo"}`,
        },
      },
    ]);
  });

  it("stores the token the server sent, and says only where it went", async () => {
    const built = harness({
      script: [reply(201, `{"id":"${PROJECT}","token":"${PROJECT_TOKEN}"}`)],
      stdin: `${ADMIN_TOKEN}\n`,
    });

    expect(
      await register(command({ adminToken: { kind: "stdin" } }), built.deps),
    ).toBe(0);
    expect(built.out).toEqual([
      `registered ${PROJECT}; token saved to ${tokenPath}`,
    ]);
    expect(built.err).toEqual([]);
    expect(built.files.writes).toEqual([
      { path: tokenPath, secret: PROJECT_TOKEN },
    ]);
  });

  it("asks for a rotation and carries the repo", async () => {
    const created = reply(
      201,
      `{"id":"${PROJECT}","token":"${PROJECT_TOKEN}"}`,
    );
    const { sent, deps } = capturing(created, {
      text: ADMIN_TOKEN,
      mode: 0o400,
    });

    expect(
      await register(
        command({
          rotate: true,
          repo: "https://github.com/example/waves.git",
        }),
        deps,
      ),
    ).toBe(0);
    expect(sent[0]?.request.url).toBe(
      "http://127.0.0.1:8080/api/v1/projects?rotate=1",
    );
    expect(sent[0]?.request.body).toBe(
      `{"id":"${PROJECT}","name":"Waves Demo","repo":"https://github.com/example/waves.git"}`,
    );
  });

  it("replaces an existing token file only when it was asked to", async () => {
    const existing = fakeFiles({
      [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 },
    });
    const built = harness({
      script: [reply(201, `{"id":"${PROJECT}","token":"rotated"}`)],
      files: Object.fromEntries(existing.store),
    });

    await expect(register(command(), built.deps)).rejects.toThrow(
      `${tokenPath} already exists; pass --rotate to replace it`,
    );
    expect(built.sent()).toBe(0);
    expect(built.files.writes).toEqual([]);
  });

  it("goes ahead over an existing token file with --rotate", async () => {
    const built = harness({
      script: [reply(201, `{"id":"${PROJECT}","token":"rotated"}`)],
      files: {
        ...ADMIN_FILE,
        [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 },
      },
    });

    expect(await register(command({ rotate: true }), built.deps)).toBe(0);
    expect(built.files.writes).toEqual([
      { path: tokenPath, secret: "rotated" },
    ]);
  });

  it("takes the admin token from a file of mode 0600 or stricter", async () => {
    const { sent, deps } = capturing(reply(201, '{"token":"t"}'), {
      text: `${ADMIN_TOKEN}\n`,
      mode: 0o400,
    });
    await register(command(), deps);
    expect(sent[0]?.request.bearer).toBe(ADMIN_TOKEN);
  });

  it("refuses an admin token file anyone else can read", async () => {
    const { sent, deps } = capturing(reply(201, '{"token":"t"}'), {
      text: ADMIN_TOKEN,
      mode: 0o644,
    });
    await expect(register(command(), deps)).rejects.toThrow(
      "/run/secrets/admin is mode 0o644; the admin token must be 0600 or stricter",
    );
    expect(sent).toEqual([]);
  });

  it("refuses an admin token file that is not there or is empty", async () => {
    const missing = harness({ script: [reply(201, '{"token":"t"}')] });
    await expect(register(command(), missing.deps)).rejects.toThrow(
      "cannot read the admin token at /run/secrets/admin",
    );

    const empty = capturing(reply(201, '{"token":"t"}'), {
      text: "\n",
      mode: 0o600,
    });
    await expect(register(command(), empty.deps)).rejects.toThrow(
      "/run/secrets/admin is empty",
    );
  });

  it("refuses an empty admin token on stdin", async () => {
    const built = harness({
      script: [reply(201, '{"token":"t"}')],
      stdin: "\n",
    });
    await expect(
      register(command({ adminToken: { kind: "stdin" } }), built.deps),
    ).rejects.toThrow("no admin token on stdin");
    expect(built.sent()).toBe(0);
  });

  it("refuses a 201 without a token", async () => {
    const built = harness({
      script: [reply(201, `{"id":"${PROJECT}"}`)],
      files: ADMIN_FILE,
    });
    await expect(register(command(), built.deps)).rejects.toThrow(
      "register failed: the server sent no token",
    );
    expect(built.files.writes).toEqual([]);
  });

  it("refuses an id that is already registered", async () => {
    const built = harness({
      script: [reply(409, '{"message":"already registered"}')],
      files: ADMIN_FILE,
    });
    await expect(register(command(), built.deps)).rejects.toThrow(
      `register failed: 409 Conflict; ${PROJECT} is registered, pass --rotate to replace its token`,
    );
  });

  it("reports the pointers of a refusal", async () => {
    const built = harness({
      script: [
        reply(422, '{"errors":[{"path":"/name","message":"expected text"}]}'),
      ],
      files: ADMIN_FILE,
    });
    await expect(register(command(), built.deps)).rejects.toThrow(
      "register failed: 422 Unprocessable Content\n  /name: expected text",
    );
  });

  it("reports why the server said no", async () => {
    const built = harness({
      script: [reply(404, '{"message":"admin registration is disabled"}')],
      files: ADMIN_FILE,
    });
    await expect(register(command(), built.deps)).rejects.toThrow(
      "register failed: 404 Not Found\n  admin registration is disabled",
    );
  });

  it("reports a network failure without retrying", async () => {
    const built = harness({
      script: [network("connect ECONNREFUSED"), reply(201, '{"token":"t"}')],
      files: ADMIN_FILE,
    });
    await expect(register(command(), built.deps)).rejects.toThrow(
      "register failed: connect ECONNREFUSED",
    );
    expect(built.sent()).toBe(1);
    expect(built.waits).toEqual([]);
  });

  it("wants a configuration it can use", async () => {
    const built = harness({ vars: { WAVES_URL: undefined } });
    await expect(register(command(), built.deps)).rejects.toThrow(
      "WAVES_URL is required",
    );
  });
});
