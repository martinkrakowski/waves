import { describe, expect, it } from "vitest";

import type { Command } from "../src/domain/args.js";
import { register } from "../src/application/register.js";
import {
  FileRefusal,
  type Files,
  type HttpRequest,
  type TransportOptions,
} from "../src/application/ports.js";
import {
  ADMIN_TOKEN,
  CONFIG_DIR,
  ENROLL_TOKEN,
  PROJECT,
  PROJECT_TOKEN,
  fakeFiles,
  harness,
  network,
  reply,
} from "./support/harness.js";

const tokenPath = `${CONFIG_DIR}/${PROJECT}.token`;

type RegisterCommand = Extract<Command, { readonly kind: "register" }>;

/** A readable admin token file, which every test past the token check needs. */
const ADMIN_FILE = {
  "/run/secrets/admin": { text: `${ADMIN_TOKEN}\n`, mode: 0o600 },
};

/** The same file, for the token that may only create what is not there yet. */
const ENROLL_FILE = {
  "/run/secrets/enroll": { text: `${ENROLL_TOKEN}\n`, mode: 0o600 },
};

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
    credential: {
      role: "admin",
      source: { kind: "file", path: "/run/secrets/admin" },
    },
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
      await register(
        command({ credential: { role: "admin", source: { kind: "stdin" } } }),
        built.deps,
      ),
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
    const built = harness({
      script: [reply(201, `{"id":"${PROJECT}","token":"rotated"}`)],
      files: {
        ...ADMIN_FILE,
        [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 },
      },
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
      register(
        command({ credential: { role: "admin", source: { kind: "stdin" } } }),
        built.deps,
      ),
    ).rejects.toThrow("no admin token on stdin");
    expect(built.sent()).toBe(0);
  });

  it("registers with an enrollment token, and never asks for a rotation", async () => {
    const sent: Sent[] = [];
    const built = harness({
      files: ENROLL_FILE,
      script: [reply(201, `{"id":"${PROJECT}","token":"${PROJECT_TOKEN}"}`)],
    });
    const deps = {
      ...built.deps,
      transport: (options: TransportOptions) => ({
        send: async (request: HttpRequest) => {
          sent.push({ options, request });
          return reply(201, `{"id":"${PROJECT}","token":"${PROJECT_TOKEN}"}`);
        },
      }),
    };

    expect(
      await register(
        command({
          credential: {
            role: "enrollment",
            source: { kind: "file", path: "/run/secrets/enroll" },
          },
        }),
        deps,
      ),
    ).toBe(0);
    expect(sent[0]?.request).toEqual({
      method: "POST",
      url: "http://127.0.0.1:8080/api/v1/projects",
      bearer: ENROLL_TOKEN,
      body: `{"id":"${PROJECT}","name":"Waves Demo"}`,
    });
    expect(built.files.writes).toEqual([
      { path: tokenPath, secret: PROJECT_TOKEN },
    ]);
  });

  it("takes an enrollment token on stdin, and names the role it wanted", async () => {
    const built = harness({
      script: [reply(201, `{"id":"${PROJECT}","token":"${PROJECT_TOKEN}"}`)],
      stdin: `${ENROLL_TOKEN}\n`,
    });

    expect(
      await register(
        command({
          credential: {
            role: "enrollment",
            source: { kind: "stdin" },
          },
        }),
        built.deps,
      ),
    ).toBe(0);
    expect(built.out).toEqual([
      `registered ${PROJECT}; token saved to ${tokenPath}`,
    ]);

    const empty = harness({
      script: [reply(201, '{"token":"t"}')],
      stdin: " ",
    });
    await expect(
      register(
        command({
          credential: { role: "enrollment", source: { kind: "stdin" } },
        }),
        empty.deps,
      ),
    ).rejects.toThrow("no enrollment token on stdin");
    expect(empty.sent()).toBe(0);
  });

  it("refuses an enrollment token file that is not there", async () => {
    const built = harness({ script: [reply(201, '{"token":"t"}')] });
    await expect(
      register(
        command({
          credential: {
            role: "enrollment",
            source: { kind: "file", path: "/run/secrets/enroll" },
          },
        }),
        built.deps,
      ),
    ).rejects.toThrow(
      "cannot read the enrollment token at /run/secrets/enroll",
    );
    expect(built.sent()).toBe(0);
  });

  it("retries a 429 for the wait the server named", async () => {
    const built = harness({
      script: [
        reply(429, '{"error":"slow down"}', { "retry-after": "2" }),
        reply(201, `{"id":"${PROJECT}","token":"${PROJECT_TOKEN}"}`),
      ],
      files: ADMIN_FILE,
    });

    expect(await register(command(), built.deps)).toBe(0);
    expect(built.sent()).toBe(2);
    expect(built.waits).toEqual([2000]);
    expect(built.files.writes).toEqual([
      { path: tokenPath, secret: PROJECT_TOKEN },
    ]);
  });

  it("gives up on a 429 that never stops, and on one it cannot wait out", async () => {
    const throttled = reply(429, '{"error":"slow down"}');
    const busy = harness({
      script: [throttled, throttled, throttled, throttled],
      files: ADMIN_FILE,
    });
    await expect(register(command(), busy.deps)).rejects.toThrow(
      "register failed: 429 Too Many Requests",
    );
    expect(busy.sent()).toBe(4);
    expect(busy.files.writes).toEqual([]);

    const forever = harness({
      script: [reply(429, "", { "retry-after": "61" })],
      files: ADMIN_FILE,
    });
    await expect(register(command(), forever.deps)).rejects.toThrow(
      "register failed: 429 Too Many Requests; the server asked to wait 61s",
    );
    expect(forever.sent()).toBe(1);
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
      script: [reply(409, '{"error":"already registered"}')],
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
      script: [reply(404, '{"error":"admin registration is disabled"}')],
      files: ADMIN_FILE,
    });
    await expect(register(command(), built.deps)).rejects.toThrow(
      "register failed: 404 Not Found\n  admin registration is disabled",
    );
  });
});

describe("a registration whose socket died", () => {
  it("repeats a request whose body never left", async () => {
    const built = harness({
      script: [
        network("write EPIPE"),
        reply(201, `{"id":"${PROJECT}","token":"${PROJECT_TOKEN}"}`),
      ],
      files: ADMIN_FILE,
    });

    expect(await register(command(), built.deps)).toBe(0);
    expect(built.sent()).toBe(2);
    expect(built.waits).toEqual([1000]);
  });

  it("gives up after two attempts that never left", async () => {
    const lost = network("write EPIPE");
    const built = harness({
      script: [lost, lost, lost],
      files: ADMIN_FILE,
    });

    await expect(register(command(), built.deps)).rejects.toThrow(
      "register failed: write EPIPE",
    );
    expect(built.sent()).toBe(3);
  });

  it("never repeats a request that may already have minted a token", async () => {
    const built = harness({
      script: [
        network("read ECONNRESET", false),
        reply(201, `{"id":"${PROJECT}","token":"${PROJECT_TOKEN}"}`),
      ],
      files: ADMIN_FILE,
    });

    await expect(register(command(), built.deps)).rejects.toThrow(
      "register failed: read ECONNRESET; the request was sent, so a token may already have been issued and lost; re-run with --rotate to get a new one",
    );
    expect(built.sent()).toBe(1);
    expect(built.waits).toEqual([]);
  });

  it("says so when a minted token cannot be written down", async () => {
    const files = fakeFiles(ADMIN_FILE);
    const refusing: Files = {
      ...files.files,
      writeSecret: async () => {
        throw new Error("ENOSPC: no space left on device");
      },
    };
    const built = harness({
      script: [reply(201, `{"id":"${PROJECT}","token":"${PROJECT_TOKEN}"}`)],
      files: ADMIN_FILE,
    });

    await expect(
      register(command(), { ...built.deps, files: refusing }),
    ).rejects.toThrow(
      `register failed: the token was issued but could not be saved to ${tokenPath}; re-run with --rotate`,
    );
    expect(built.out).toEqual([]);
  });

  it("says so when the directory turns bad between the check and the write", async () => {
    const files = fakeFiles(ADMIN_FILE);
    const refusal = new FileRefusal(
      `${CONFIG_DIR} is a symbolic link; point WAVES_CONFIG_DIR at the directory itself`,
    );
    const built = harness({
      script: [reply(201, `{"id":"${PROJECT}","token":"${PROJECT_TOKEN}"}`)],
      files: ADMIN_FILE,
    });

    await expect(
      register(command(), {
        ...built.deps,
        files: {
          ...files.files,
          writeSecret: async () => {
            throw refusal;
          },
        },
      }),
    ).rejects.toThrow(
      `${CONFIG_DIR} is a symbolic link; point WAVES_CONFIG_DIR at the directory itself; the token the server issued was not saved, so re-run with --rotate`,
    );
  });

  it("wants a configuration it can use", async () => {
    const built = harness({ vars: { WAVES_URL: undefined } });
    await expect(register(command(), built.deps)).rejects.toThrow(
      "WAVES_URL is required",
    );
  });
});

describe("the config directory, checked before anything is minted", () => {
  it("spends the admin token on nothing at all when the directory is bad", async () => {
    const built = harness({
      script: [reply(201, `{"id":"${PROJECT}","token":"${PROJECT_TOKEN}"}`)],
      files: ADMIN_FILE,
    });
    const refusal = new FileRefusal(
      `${CONFIG_DIR} is mode 0o755; run chmod 700 ${CONFIG_DIR} so only you can reach the tokens in it`,
    );
    let checked = "";
    const checkedFiles: Files = {
      ...built.deps.files,
      checkSecretDirectory: async (path) => {
        checked = path;
        throw refusal;
      },
    };

    await expect(
      register(command(), { ...built.deps, files: checkedFiles }),
    ).rejects.toBe(refusal);
    expect(checked).toBe(CONFIG_DIR);
    expect(built.sent()).toBe(0);
    expect(built.files.writes).toEqual([]);
  });

  it("asks about the directory before it reads the admin token", async () => {
    const built = harness({
      script: [reply(201, `{"id":"${PROJECT}","token":"${PROJECT_TOKEN}"}`)],
      files: {},
    });
    const order: string[] = [];
    const files: Files = {
      ...built.deps.files,
      checkSecretDirectory: async () => {
        order.push("directory");
      },
      readSecret: async () => {
        order.push("admin token");
        return { text: ADMIN_TOKEN, mode: 0o600 };
      },
    };

    expect(await register(command(), { ...built.deps, files })).toBe(0);
    expect(order).toEqual(["directory", "admin token"]);
  });
});
