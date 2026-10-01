import {
  chmod,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { main } from "../src/index.js";
import {
  environmentOf,
  recorder,
  temporaryDirectory,
} from "./support/harness.js";
import {
  STUB_ADMIN_TOKEN,
  startStub,
  type Stub,
} from "./support/stub-server.js";

const WAVE = "wv5";
const ADMIN_FILE = "admin.token";

const LANES = JSON.stringify({
  lanes: [
    {
      id: "wv5",
      reported: {
        stage: "build",
        event: "settled",
        ts: "2026-02-03T04:05:06.789Z",
      },
      derived: {
        alive: false,
        exit: 0,
        log: { bytes: 10, mtimeMs: 1_772_000_000_000, tail: "noisy\n" },
      },
      disagreements: [],
    },
  ],
});

const NOW = Date.parse("2026-02-03T04:05:06.789Z");

let stub: Stub;
let directory: string;
let configDir: string;

interface Options {
  readonly project?: string;
  readonly stdin?: string;
  readonly file?: string;
  readonly now?: number;
  readonly adminFile?: string;
  readonly adminText?: string;
  readonly vars?: Readonly<Record<string, string | undefined>>;
}

beforeAll(async () => {
  stub = await startStub();
  directory = (await temporaryDirectory()).path;
  configDir = join(directory, "config");
});

afterAll(async () => {
  await stub.stop();
  await rm(directory, { recursive: true, force: true });
});

beforeEach(async () => {
  await rm(configDir, { recursive: true, force: true });
});

/**
 * The client, with only the clock, the environment and the input replaced: the
 * filesystem and the http client are the real ones, and so are the file modes
 * and the sockets this asserts on.
 */
async function waves(
  argv: readonly string[],
  options: Options = {},
): Promise<{
  readonly code: number;
  readonly out: string[];
  readonly err: string[];
  readonly waits: number[];
}> {
  const recorded = recorder();
  const adminFile = join(directory, options.adminFile ?? ADMIN_FILE);
  await writeFile(adminFile, `${options.adminText ?? STUB_ADMIN_TOKEN}\n`, {
    mode: 0o600,
  });
  const waits: number[] = [];
  const code = await main(argv, recorded.io, {
    env: environmentOf({
      WAVES_URL: stub.origin,
      WAVES_PROJECT: options.project ?? "waves-demo",
      WAVES_CONFIG_DIR: configDir,
      ...options.vars,
    }),
    input: { read: async () => options.stdin ?? "" },
    clock: { now: () => options.now ?? NOW },
    sleeper: {
      sleep: async (ms) => {
        waits.push(ms);
      },
    },
  });
  return { code, out: recorded.out, err: recorded.err, waits };
}

function register(
  project: string,
  extra: readonly string[] = [],
): readonly string[] {
  return [
    "register",
    project,
    "--name",
    "Waves Demo",
    "--admin-token-file",
    join(directory, ADMIN_FILE),
    ...extra,
  ];
}

function tokenFile(project: string): string {
  return join(configDir, `${project}.token`);
}

function puts(wave: string): readonly {
  readonly method: string;
  readonly expect: string | undefined;
  readonly origin: string | undefined;
  readonly authorization: string | undefined;
  readonly contentType: string | undefined;
  readonly body: string;
}[] {
  return stub.requests.filter(
    (entry) => entry.method === "PUT" && entry.path.endsWith(`/waves/${wave}`),
  );
}

/** Every request the stub was asked to register something, before or after this one. */
function posts(): readonly string[] {
  return stub.requests
    .filter((entry) => entry.method === "POST")
    .map((entry) => entry.path);
}

/** The body of the push the stub was willing to read: the first attempt is throttled on its headers. */
function bodyOf(wave: string): string {
  const carried = puts(wave).find((entry) => entry.body !== "");
  if (carried === undefined) {
    throw new Error(`the stub never read the body of ${wave}`);
  }
  return carried.body;
}

describe("a real loopback server", () => {
  it("registers a project, pushes a wave and deletes it again", async () => {
    const project = "waves-demo";
    const registered = await waves(
      register(project, ["--repo", "https://github.com/example/waves.git"]),
    );
    expect(registered).toEqual({
      code: 0,
      out: [`registered ${project}; token saved to ${tokenFile(project)}`],
      err: [],
      waits: [],
    });

    expect((await stat(tokenFile(project))).mode & 0o777).toBe(0o600);
    expect((await stat(configDir)).mode & 0o777).toBe(0o700);
    expect(await readFile(tokenFile(project), "utf8")).toBe(
      stub.tokenOf(project),
    );

    const pushed = await waves(["push", "--wave", WAVE, "--stdin"], {
      project,
      stdin: LANES,
    });
    expect(pushed.code).toBe(0);
    expect(pushed.out[0]).toMatch(
      new RegExp(`^pushed ${project}/${WAVE} at \\d{4}-\\d{2}-\\d{2}T`),
    );
    expect(pushed.err).toEqual([]);

    // The stub throttles the first attempt, so a wave arrives twice.
    const put = puts(WAVE);
    expect(put).toHaveLength(2);
    expect(put[0]?.expect).toBe("100-continue");
    expect(put[0]?.origin).toBeUndefined();
    expect(put[0]?.authorization).toBe(`Bearer ${stub.tokenOf(project)}`);
    expect(put[0]?.contentType).toBe("application/json");

    const deleted = await waves(["delete", "--wave", WAVE], { project });
    expect(deleted).toEqual({
      code: 0,
      out: [`deleted ${project}/${WAVE}`],
      err: [],
      waits: [],
    });

    const again = await waves(["delete", "--wave", WAVE], { project });
    expect(again.code).toBe(1);
    expect(again.err).toEqual([
      `waves delete: delete failed: 404 Not Found; ${project}/${WAVE} is not stored`,
    ]);
  });

  it("drops every tail on the way, unless it is asked to keep them", async () => {
    const project = "waves-tails";
    await waves(register(project));
    const plain = await waves(["push", "--wave", "wv5", "--stdin"], {
      project,
      stdin: LANES,
    });
    const kept = await waves(
      [
        "push",
        "--wave",
        "wv6",
        "--stdin",
        "--include-tails",
        "--interval",
        "60",
      ],
      { project, stdin: LANES },
    );
    expect([plain.code, kept.code]).toEqual([0, 0]);

    const without = JSON.parse(bodyOf("wv5")) as {
      readonly intervalSeconds: number | null;
      readonly lanes: readonly {
        readonly derived: { readonly log?: { readonly tail?: string } };
      }[];
    };
    expect(without.lanes[0]?.derived.log?.tail).toBeUndefined();
    expect(without.intervalSeconds).toBeNull();

    const with_ = JSON.parse(bodyOf("wv6")) as {
      readonly intervalSeconds: number | null;
      readonly lanes: readonly {
        readonly derived: { readonly log?: { readonly tail?: string } };
      }[];
    };
    expect(with_.lanes[0]?.derived.log?.tail).toBe("noisy\n");
    expect(with_.intervalSeconds).toBe(60);
  });

  it("waits for Retry-After and pushes again", async () => {
    const project = "waves-throttle";
    await waves(register(project));
    const pushed = await waves(["push", "--wave", WAVE, "--stdin"], {
      project,
      stdin: LANES,
    });
    expect(pushed.code).toBe(0);
    expect(pushed.waits).toEqual([1000]);
  });

  it("refuses a bad admin token, and an id that is taken", async () => {
    const project = "waves-refused";
    const refused = await waves(register(project), {
      adminText: "not-the-admin-token",
    });
    expect(refused.code).toBe(1);
    expect(refused.out).toEqual([]);
    expect(refused.err).toEqual([
      "waves register: register failed: 401 Unauthorized\n  the admin token was refused",
    ]);

    await waves(register(project));
    await rm(tokenFile(project));
    const taken = await waves(register(project));
    expect(taken.code).toBe(1);
    expect(taken.err[0]).toContain("409 Conflict");
    expect(taken.err[0]).toContain("--rotate");
  });

  it("refuses a token of another project, and a snapshot it cannot take", async () => {
    const project = "waves-push";
    await waves(register(project));
    await writeFile(tokenFile(project), "waves-stub-project-t0ken-other-99", {
      mode: 0o600,
    });
    const refused = await waves(["push", "--wave", WAVE, "--stdin"], {
      project,
      stdin: LANES,
    });
    expect(refused.code).toBe(1);
    expect(refused.err).toEqual([
      "waves push: push failed: 403 Forbidden\n  that token belongs to another project",
    ]);

    await writeFile(tokenFile(project), "no-such-token", { mode: 0o600 });
    const unknown = await waves(["push", "--wave", WAVE, "--stdin"], {
      project,
      stdin: LANES,
    });
    expect(unknown.code).toBe(1);
    expect(unknown.err[0]).toContain("403 Forbidden");

    await waves(register(project, ["--rotate"]));
    const skewed = await waves(["push", "--wave", WAVE, "--stdin"], {
      project,
      stdin: LANES,
      now: Date.parse("2030-02-03T04:05:06.789Z"),
    });
    expect(skewed.code).toBe(1);
    expect(skewed.err).toEqual([
      "waves push: push failed: 422 Unprocessable Content\n  /generatedAt: too far from the server clock",
    ]);
  });

  it("prints the reason of a 401 on a snapshot too big to send", async () => {
    // A project the server has never heard of, so the refusal lands on the
    // headers alone and the snapshot behind them is never read.
    const project = "waves-big";
    await mkdir(configDir, { recursive: true, mode: 0o700 });
    await writeFile(tokenFile(project), "waves-never-registered", {
      mode: 0o600,
    });
    const lanes = JSON.stringify({
      lanes: Array.from({ length: 200 }, (_unused, index) => ({
        id: `lane-${index}`,
        derived: {
          alive: false,
          log: {
            bytes: 4096,
            mtimeMs: 1_772_000_000_000,
            tail: "x".repeat(4000),
          },
        },
        disagreements: [],
      })),
    });
    const big = join(directory, "big.json");
    await writeFile(big, lanes, { mode: 0o644 });
    expect(Buffer.byteLength(lanes)).toBeGreaterThan(64 * 1024);

    const refused = await waves(
      ["push", "--wave", "wv-big", "--file", big, "--include-tails"],
      { project },
    );

    // The server refused on the headers, so the snapshot was never written and
    // the answer is the refusal, not a socket that died mid-transfer.
    expect(refused.code).toBe(1);
    expect(refused.err).toEqual([
      "waves push: push failed: 401 Unauthorized\n  the project token was refused",
    ]);
    expect(puts("wv-big")).toHaveLength(1);
    expect(puts("wv-big")[0]?.body).toBe("");
  });

  it("refuses to push with a token file anyone else can read", async () => {
    const project = "waves-mode";
    await waves(register(project));
    await chmod(tokenFile(project), 0o644);
    const refused = await waves(["push", "--wave", WAVE, "--stdin"], {
      project,
      stdin: LANES,
    });
    expect(refused.code).toBe(2);
    expect(refused.err).toEqual([
      `waves push: ${tokenFile(project)} is mode 0o644; it must be 0600 or stricter`,
    ]);
  });

  it("refuses a token file that is a link", async () => {
    const project = "waves-link";
    await waves(register(project));
    const target = join(directory, "elsewhere.token");
    await writeFile(target, stub.tokenOf(project) ?? "", { mode: 0o600 });
    await rm(tokenFile(project));
    await symlink(target, tokenFile(project));

    const refused = await waves(["push", "--wave", WAVE, "--stdin"], {
      project,
      stdin: LANES,
    });
    expect(refused.code).toBe(2);
    expect(refused.err[0]).toContain(
      `${tokenFile(project)} is a symbolic link; the token file must be a regular file`,
    );
  });

  it("refuses a config directory anyone else can reach, and says what to run", async () => {
    const project = "waves-dir";
    await mkdir(configDir, { recursive: true, mode: 0o750 });
    const before = posts();

    const refused = await waves(register(project));

    expect(refused.code).toBe(2);
    expect(refused.err[0]).toContain(`run chmod 700 ${configDir}`);
    expect((await stat(configDir)).mode & 0o777).toBe(0o750);
    // Nothing was asked of the server, so there is no token to have lost.
    expect(posts()).toEqual(before);
  });

  it("refuses a config directory that is a link", async () => {
    const project = "waves-dirlink";
    const real = join(directory, "real");
    await mkdir(real, { mode: 0o700 });
    await symlink(real, configDir);
    const before = posts();

    const refused = await waves(register(project));

    expect(refused.code).toBe(2);
    expect(refused.err[0]).toContain("is a symbolic link");
    expect(posts()).toEqual(before);
    await rm(configDir);
  });
});
