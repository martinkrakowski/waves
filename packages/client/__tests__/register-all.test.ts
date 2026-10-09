import { chmod, mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { run } from "../src/application/entrypoint.js";
import {
  FileRefusal,
  type Files,
  type HttpRequest,
  type TransportOutcome,
} from "../src/application/ports.js";
import { main } from "../src/index.js";
import {
  CONFIG_DIR,
  ENROLL_TOKEN,
  PROJECT_TOKEN,
  bearerOf,
  environmentOf,
  fakeFiles,
  harness,
  network,
  reply,
  registerSecret,
  temporaryDirectory,
  type FakeFiles,
  type FileEntry,
} from "./support/harness.js";

const LIST_PATH = `${CONFIG_DIR}/projects.json`;
const ENROLL_FILE = "/run/secrets/enroll";
const ENROLL = { [ENROLL_FILE]: { text: `${ENROLL_TOKEN}\n`, mode: 0o600 } };
const ONE = "waves-one";
const TWO = "waves-two";

/** The tokens the stub answers with, each registered so a leak fails a test. */
const ISSUED_ONE = "waves-issued-t0ken-aa1101";
const ISSUED_TWO = "waves-issued-t0ken-bb2202";
registerSecret(ISSUED_ONE);
registerSecret(ISSUED_TWO);

function created(id: string, token: string) {
  return reply(201, `{"id":"${id}","token":"${token}"}`);
}

function list(...entries: readonly unknown[]): string {
  return JSON.stringify(entries);
}

interface RunInput {
  readonly entries?: readonly unknown[];
  /** The file as it is on disk, when a test needs something the list is not. */
  readonly text?: string;
  readonly script?: readonly TransportOutcome[];
  readonly files?: Readonly<Record<string, FileEntry>>;
  /** A port the fake does not have, for a filesystem that turns bad mid-run. */
  readonly port?: Partial<Files>;
  readonly argv?: readonly string[];
  /** A list somewhere other than the config directory. */
  readonly listPath?: string;
  readonly listText?: string;
  /** No list at all, which is the owner's own mistake to find. */
  readonly omitList?: boolean;
}

interface Run {
  readonly code: number;
  readonly out: readonly string[];
  readonly err: readonly string[];
  readonly waits: readonly number[];
  readonly requests: readonly HttpRequest[];
  readonly files: FakeFiles;
}

async function runAll(input: RunInput = {}): Promise<Run> {
  const path = input.listPath ?? LIST_PATH;
  const built = harness({
    script: input.script,
    files: {
      ...(input.omitList === true
        ? {}
        : {
            [path]: {
              text:
                input.listText ?? input.text ?? list(...(input.entries ?? [])),
              mode: 0o644,
            },
          }),
      ...ENROLL,
      ...input.files,
    },
  });
  const argv = [
    "register-all",
    "--enrollment-token-file",
    ENROLL_FILE,
    ...(input.argv ?? []),
  ];
  const deps =
    input.port === undefined
      ? built.deps
      : { ...built.deps, files: { ...built.deps.files, ...input.port } };
  const code = await run(argv, built.io, deps);
  return {
    code,
    out: built.out,
    err: built.err,
    waits: built.waits,
    requests: built.requests,
    files: built.files,
  };
}

const tokenPathOf = (id: string): string => `${CONFIG_DIR}/${id}.token`;

describe("register-all", () => {
  it("registers nothing when every entry already has a token file", async () => {
    const result = await runAll({
      entries: [
        { id: ONE, name: "One" },
        { id: TWO, name: "Two" },
      ],
      files: {
        [tokenPathOf(ONE)]: { text: PROJECT_TOKEN, mode: 0o600 },
        [tokenPathOf(TWO)]: { text: PROJECT_TOKEN, mode: 0o600 },
      },
    });

    expect(result.code).toBe(0);
    expect(result.requests).toEqual([]);
    expect(result.out).toEqual([
      "2 skipped, 0 registered, 0 conflicts, 0 failed",
    ]);
    expect(result.files.writes).toEqual([]);
  });

  it("registers each new entry, waits for the throttle and then for the pace", async () => {
    const result = await runAll({
      entries: [
        { id: ONE, name: "One" },
        { id: TWO, name: "Two" },
      ],
      script: [
        reply(429, '{"error":"slow down"}', { "retry-after": "2" }),
        created(ONE, ISSUED_ONE),
        created(TWO, ISSUED_TWO),
      ],
    });

    expect(result.code).toBe(0);
    expect(result.out).toEqual([
      `registered ${ONE}; token saved to ${tokenPathOf(ONE)}`,
      `registered ${TWO}; token saved to ${tokenPathOf(TWO)}`,
      "0 skipped, 2 registered, 0 conflicts, 0 failed",
    ]);
    expect(result.err).toEqual([]);
    // The wait the server asked for, and the one second between two writes.
    expect(result.waits).toEqual([2000, 1000]);
    expect(result.requests.map((request) => request.url)).toEqual([
      "http://127.0.0.1:8080/api/v1/projects",
      "http://127.0.0.1:8080/api/v1/projects",
      "http://127.0.0.1:8080/api/v1/projects",
    ]);
    for (const request of result.requests) {
      expect(request.url).not.toContain("rotate=1");
      expect(bearerOf(request)).toBe(ENROLL_TOKEN);
    }
    expect(result.requests[0]?.body).toBe(`{"id":"${ONE}","name":"One"}`);
    expect(result.files.writes).toEqual([
      { path: tokenPathOf(ONE), secret: ISSUED_ONE },
      { path: tokenPathOf(TWO), secret: ISSUED_TWO },
    ]);
  });

  it("says no line of it holds a token", async () => {
    const result = await runAll({
      entries: [{ id: ONE, name: "One" }],
      script: [created(ONE, ISSUED_ONE)],
    });
    for (const line of [...result.out, ...result.err]) {
      expect(line).not.toContain(ISSUED_ONE);
      expect(line).not.toContain(ENROLL_TOKEN);
    }
  });

  it("goes on past a 409, which is the owner's state and not a failure", async () => {
    const result = await runAll({
      entries: [
        { id: ONE, name: "One" },
        { id: TWO, name: "Two" },
      ],
      script: [
        created(ONE, ISSUED_ONE),
        reply(409, '{"error":"the project is already registered"}'),
        created(TWO, ISSUED_TWO),
      ],
    });

    expect(result.code).toBe(0);
    expect(result.err).toEqual([
      `${TWO} is registered and its token is not on this machine (registered elsewhere, or lost after a cut connection); recover it with an admin rotate or remove the entry`,
    ]);
    expect(result.out).toEqual([
      `registered ${ONE}; token saved to ${tokenPathOf(ONE)}`,
      "0 skipped, 1 registered, 1 conflicts, 0 failed",
    ]);
    // A 409 is answered by a plain POST: nothing here may ask for a rotation.
    for (const request of result.requests) {
      expect(request.url).not.toContain("rotate=1");
    }
    expect(result.files.writes).toEqual([
      { path: tokenPathOf(ONE), secret: ISSUED_ONE },
    ]);
  });

  it("stops the run after a 401, which is about the token and not the project", async () => {
    const result = await runAll({
      entries: [
        { id: ONE, name: "One" },
        { id: TWO, name: "Two" },
      ],
      script: [
        reply(401, '{"error":"the admin token was refused"}'),
        created(TWO, ISSUED_TWO),
      ],
    });

    expect(result.code).toBe(1);
    expect(result.requests).toHaveLength(1);
    expect(result.err).toEqual([
      `${ONE}: the server refused the enrollment token for this run, stopping: 401 Unauthorized\n  the admin token was refused`,
    ]);
    expect(result.out).toEqual([
      "0 skipped, 0 registered, 0 conflicts, 1 failed",
    ]);
    expect(result.files.writes).toEqual([]);
  });

  it("stops on a 403 too, and names what the server said", async () => {
    const result = await runAll({
      entries: [
        { id: ONE, name: "One" },
        { id: TWO, name: "Two" },
      ],
      script: [
        reply(403, '{"error":"enrollment ceiling reached"}'),
        created(TWO, ISSUED_TWO),
      ],
    });

    expect(result.code).toBe(1);
    expect(result.requests).toHaveLength(1);
    expect(result.err).toEqual([
      `${ONE}: the server refused the enrollment token for this run, stopping: 403 Forbidden\n  enrollment ceiling reached`,
    ]);
  });

  it("goes on after a 500, and the run still fails", async () => {
    const result = await runAll({
      entries: [
        { id: ONE, name: "One" },
        { id: TWO, name: "Two" },
      ],
      // A 5xx is not retried, as `register` has never retried it: a POST may
      // already have minted a token, so asking again would be a second project.
      script: [
        reply(500, '{"error":"the registry is closed"}'),
        created(TWO, ISSUED_TWO),
      ],
    });

    expect(result.code).toBe(1);
    expect(result.err).toEqual([
      `${ONE}: 500 Internal Server Error\n  the registry is closed`,
    ]);
    expect(result.out).toEqual([
      `registered ${TWO}; token saved to ${tokenPathOf(TWO)}`,
      "0 skipped, 1 registered, 0 conflicts, 1 failed",
    ]);
    expect(result.requests).toHaveLength(2);
    expect(result.waits).toEqual([1000]);
  });

  it("stops on a throttle it is not allowed to wait out", async () => {
    const result = await runAll({
      entries: [
        { id: ONE, name: "One" },
        { id: TWO, name: "Two" },
      ],
      script: [
        reply(429, '{"error":"slow down"}', { "retry-after": "61" }),
        created(TWO, ISSUED_TWO),
      ],
    });

    expect(result.code).toBe(1);
    expect(result.requests).toHaveLength(1);
    expect(result.err).toEqual([
      `${ONE}: the server asked to wait 61s, stopping: 429 Too Many Requests`,
    ]);
    expect(result.out).toEqual([
      "0 skipped, 0 registered, 0 conflicts, 1 failed",
    ]);
  });

  it("goes on after a throttle that never stops", async () => {
    const throttled = reply(429, '{"error":"slow down"}');
    const result = await runAll({
      entries: [
        { id: ONE, name: "One" },
        { id: TWO, name: "Two" },
      ],
      script: [
        throttled,
        throttled,
        throttled,
        throttled,
        created(TWO, ISSUED_TWO),
      ],
    });

    expect(result.code).toBe(1);
    expect(result.err).toEqual([`${ONE}: 429 Too Many Requests`]);
    expect(result.out).toEqual([
      `registered ${TWO}; token saved to ${tokenPathOf(TWO)}`,
      "0 skipped, 1 registered, 0 conflicts, 1 failed",
    ]);
  });

  it("reports a socket that died after the body, and goes on", async () => {
    const result = await runAll({
      entries: [
        { id: ONE, name: "One" },
        { id: TWO, name: "Two" },
      ],
      script: [network("read ECONNRESET", false), created(TWO, ISSUED_TWO)],
    });

    expect(result.code).toBe(1);
    expect(result.err).toEqual([
      `${ONE}: read ECONNRESET; the token may have been issued and lost; recover it with an admin rotate`,
    ]);
    expect(result.out).toEqual([
      `registered ${TWO}; token saved to ${tokenPathOf(TWO)}`,
      "0 skipped, 1 registered, 0 conflicts, 1 failed",
    ]);
    // One request for the lost one: asking again would say nothing about it.
    expect(result.requests).toHaveLength(2);
  });

  it("reports a socket that died before anything was sent, without the loss", async () => {
    const gone = network("connect ECONNREFUSED");
    const result = await runAll({
      entries: [{ id: ONE, name: "One" }],
      script: [gone, gone, gone],
    });

    expect(result.code).toBe(1);
    expect(result.err).toEqual([`${ONE}: connect ECONNREFUSED`]);
  });

  it("reports a 201 that carried no token", async () => {
    const result = await runAll({
      entries: [{ id: ONE, name: "One" }],
      script: [reply(201, `{"id":"${ONE}"}`)],
    });

    expect(result.code).toBe(1);
    expect(result.err).toEqual([`${ONE}: the server sent no token`]);
    expect(result.files.writes).toEqual([]);
  });

  it("reports a token the filesystem would not take, and goes on", async () => {
    const refusal = new FileRefusal(
      `${tokenPathOf(ONE)} is mode 0o644; it must be 0600 or stricter`,
    );
    const refusing: Partial<Files> = {
      writeSecret: async (path) => {
        if (path === tokenPathOf(ONE)) {
          throw refusal;
        }
        await fakeFiles({}).files.writeSecret(path, ISSUED_TWO);
      },
    };
    const result = await runAll({
      entries: [
        { id: ONE, name: "One" },
        { id: TWO, name: "Two" },
      ],
      script: [created(ONE, ISSUED_ONE), created(TWO, ISSUED_TWO)],
      port: refusing,
    });

    expect(result.code).toBe(1);
    expect(result.err).toEqual([
      `${ONE}: ${tokenPathOf(ONE)} is mode 0o644; it must be 0600 or stricter; the token may have been issued and lost; recover it with an admin rotate`,
    ]);
    expect(result.out).toEqual([
      `registered ${TWO}; token saved to ${tokenPathOf(TWO)}`,
      "0 skipped, 1 registered, 0 conflicts, 1 failed",
    ]);
  });

  it("reports a token the disk would not take, and goes on", async () => {
    const result = await runAll({
      entries: [
        { id: ONE, name: "One" },
        { id: TWO, name: "Two" },
      ],
      script: [created(ONE, ISSUED_ONE), created(TWO, ISSUED_TWO)],
      port: {
        writeSecret: async (path) => {
          if (path === tokenPathOf(ONE)) {
            throw new Error("ENOSPC: no space left on device");
          }
          await fakeFiles({}).files.writeSecret(path, ISSUED_TWO);
        },
      },
    });

    expect(result.code).toBe(1);
    expect(result.err).toEqual([
      `${ONE}: the token was issued but could not be saved to ${tokenPathOf(ONE)}; the token may have been issued and lost; recover it with an admin rotate`,
    ]);
    expect(result.out).toEqual([
      `registered ${TWO}; token saved to ${tokenPathOf(TWO)}`,
      "0 skipped, 1 registered, 0 conflicts, 1 failed",
    ]);
  });

  it("lets a bug out with its stack rather than calling it a failed entry", async () => {
    await expect(
      runAll({
        entries: [
          { id: ONE, name: "One" },
          { id: TWO, name: "Two" },
        ],
        script: [created(TWO, ISSUED_TWO)],
        port: {
          exists: async () => {
            throw new TypeError("a bug, not a file");
          },
        },
      }),
    ).rejects.toThrow(TypeError);
  });

  it("reports a token file it cannot even look at, and still summarises", async () => {
    const result = await runAll({
      entries: [
        { id: ONE, name: "One" },
        { id: TWO, name: "Two" },
      ],
      script: [created(TWO, ISSUED_TWO)],
      port: {
        exists: async (path) => {
          if (path === tokenPathOf(ONE)) {
            throw new FileRefusal(`${path} could not be read: EACCES`);
          }
          return false;
        },
      },
    });

    expect(result.code).toBe(1);
    expect(result.err).toEqual([
      `${ONE}: ${tokenPathOf(ONE)} could not be read: EACCES`,
    ]);
    expect(result.out).toEqual([
      `registered ${TWO}; token saved to ${tokenPathOf(TWO)}`,
      "0 skipped, 1 registered, 0 conflicts, 1 failed",
    ]);
  });

  it("lets a bug travel out rather than counting it as a failed entry", async () => {
    await expect(
      runAll({
        entries: [{ id: ONE, name: "One" }],
        port: {
          exists: () => {
            throw "not even an error";
          },
        },
      }),
    ).rejects.toBe("not even an error");
    await expect(
      runAll({
        entries: [{ id: ONE, name: "One" }],
        script: [created(ONE, ISSUED_ONE)],
        port: {
          writeSecret: () => {
            throw "not even an error";
          },
        },
      }),
    ).rejects.toBe("not even an error");
  });

  it("prints the skip lines only when it was asked to be verbose", async () => {
    const entries = [{ id: ONE, name: "One" }];
    const files = { [tokenPathOf(ONE)]: { text: PROJECT_TOKEN, mode: 0o600 } };

    const quiet = await runAll({ entries, files });
    expect(quiet.code).toBe(0);
    expect(quiet.out).toEqual([
      "1 skipped, 0 registered, 0 conflicts, 0 failed",
    ]);

    const loud = await runAll({ entries, files, argv: ["--verbose"] });
    expect(loud.code).toBe(0);
    expect(loud.out).toEqual([
      `skip ${ONE}: a token file is present`,
      "1 skipped, 0 registered, 0 conflicts, 0 failed",
    ]);
  });

  it("has nothing to do, and says so, for an empty list", async () => {
    const result = await runAll({ entries: [] });
    expect(result.code).toBe(0);
    expect(result.requests).toEqual([]);
    expect(result.out).toEqual([
      "0 skipped, 0 registered, 0 conflicts, 0 failed",
    ]);
  });

  it("reads the list --projects names, rather than the one in the config directory", async () => {
    const result = await runAll({
      entries: [{ id: ONE, name: "One" }],
      listPath: "/elsewhere/list.json",
      argv: ["--projects", "/elsewhere/list.json"],
      script: [created(ONE, ISSUED_ONE)],
    });

    expect(result.code).toBe(0);
    expect(result.out).toEqual([
      `registered ${ONE}; token saved to ${tokenPathOf(ONE)}`,
      "0 skipped, 1 registered, 0 conflicts, 0 failed",
    ]);
  });

  it("wants a list it can read", async () => {
    const missing = await runAll({ omitList: true });
    expect(missing.code).toBe(2);
    expect(missing.requests).toEqual([]);
    expect(missing.err).toEqual([
      `waves register-all: no projects file at ${LIST_PATH}`,
    ]);
    expect(missing.out).toEqual([]);
  });

  it("sends nothing at all when one entry is refused", async () => {
    const result = await runAll({
      entries: [
        { id: ONE, name: "One" },
        { id: "Not An Id", name: "Bad" },
      ],
      script: [created(ONE, ISSUED_ONE)],
    });

    expect(result.code).toBe(2);
    expect(result.requests).toEqual([]);
    expect(result.files.writes).toEqual([]);
    expect(result.err).toEqual([
      "waves register-all: entry 1: id is not a project id",
    ]);
    expect(result.out).toEqual([]);
  });

  it("reads the list before it asks for a token it can read", async () => {
    const built = harness({
      files: {
        [LIST_PATH]: { text: list({ id: ONE, name: "One" }), mode: 0o644 },
      },
      script: [created(ONE, ISSUED_ONE)],
    });
    const code = await run(
      ["register-all", "--enrollment-token-file", "/run/secrets/enroll"],
      built.io,
      built.deps,
    );
    expect(code).toBe(2);
    expect(built.err).toEqual([
      "waves register-all: cannot read the enrollment token at /run/secrets/enroll",
    ]);
    expect(built.sent()).toBe(0);
  });

  it("wants a configuration it can use", async () => {
    const built = harness({
      files: { [LIST_PATH]: { text: list(), mode: 0o644 }, ...ENROLL },
      vars: { WAVES_URL: undefined },
    });
    expect(
      await run(
        ["register-all", "--enrollment-token-file", ENROLL_FILE],
        built.io,
        built.deps,
      ),
    ).toBe(2);
    expect(built.err).toEqual(["waves register-all: WAVES_URL is required"]);
  });

  it("refuses a config directory that cannot hold a secret safely", async () => {
    const built = harness({
      files: { [LIST_PATH]: { text: list(), mode: 0o644 }, ...ENROLL },
    });
    const refusal = new FileRefusal(`${CONFIG_DIR} is not a directory`);
    expect(
      await run(
        ["register-all", "--enrollment-token-file", ENROLL_FILE],
        built.io,
        {
          ...built.deps,
          files: {
            ...built.deps.files,
            checkSecretDirectory: async () => {
              throw refusal;
            },
          },
        },
      ),
    ).toBe(2);
    expect(built.err).toEqual([
      `waves register-all: ${CONFIG_DIR} is not a directory`,
    ]);
    expect(built.sent()).toBe(0);
  });
});

describe("a token file on the real filesystem", () => {
  it("is written 0600, which the fake cannot prove", async () => {
    const directory = (await temporaryDirectory()).path;
    const configDir = join(directory, "config");
    await mkdir(configDir);
    await chmod(configDir, 0o700);
    await writeFile(
      join(configDir, "projects.json"),
      list({ id: ONE, name: "One" }),
    );
    await writeFile(join(directory, "enroll.token"), `${ENROLL_TOKEN}\n`, {
      mode: 0o600,
    });
    const out: string[] = [];
    const err: string[] = [];
    const script = [created(ONE, ISSUED_ONE)];

    const code = await main(
      [
        "register-all",
        "--enrollment-token-file",
        join(directory, "enroll.token"),
      ],
      { out: (line) => out.push(line), err: (line) => err.push(line) },
      {
        env: environmentOf({
          WAVES_URL: "http://127.0.0.1:8080",
          WAVES_CONFIG_DIR: configDir,
        }),
        clock: { now: () => Date.parse("2026-02-03T04:05:06.789Z") },
        sleeper: { sleep: async () => undefined },
        transport: () => ({
          send: async () => {
            const next = script.shift();
            if (next === undefined) {
              throw new Error("the stub ran out of answers");
            }
            return next;
          },
        }),
      },
    );

    expect(code).toBe(0);
    expect(err).toEqual([]);
    expect(out).toEqual([
      `registered ${ONE}; token saved to ${join(configDir, `${ONE}.token`)}`,
      "0 skipped, 1 registered, 0 conflicts, 0 failed",
    ]);
    const info = await stat(join(configDir, `${ONE}.token`));
    expect(info.mode & 0o777).toBe(0o600);
  });
});
