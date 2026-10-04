import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
  STUB_ENROLL_TOKEN,
  startStub,
  type Stub,
} from "./support/stub-server.js";

/**
 * Every secret this file puts on the wire. The tokens the stub issues are added
 * as they are issued; the ones a test writes itself are here from the start.
 */
const secrets = new Set<string>([
  STUB_ADMIN_TOKEN,
  STUB_ENROLL_TOKEN,
  "not-the-admin-token",
  "not-the-enrollment-token",
  "waves-leak-t0ken-not-mine",
]);

const WAVE = "wv5";
const NOW = Date.parse("2026-02-03T04:05:06.789Z");

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
        log: { bytes: 10, mtimeMs: 1_772_000_000_000, tail: "noisy\n" },
      },
      disagreements: [],
    },
  ],
});

const STATUS = JSON.stringify({
  prs: { skipped: 2 },
  backlog: { state: "recorded", at: "2026-10-03T07:55:00Z" },
});

let stub: Stub;
let directory: string;
let configDir: string;

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

interface Run {
  readonly code: number;
  readonly lines: string[];
}

/**
 * Runs one command and keeps every word it said, on either stream, plus the
 * message of anything it threw.
 */
async function run(
  argv: readonly string[],
  options: {
    readonly project?: string;
    readonly stdin?: string;
    readonly now?: number;
    readonly adminText?: string;
    readonly vars?: Readonly<Record<string, string | undefined>>;
  } = {},
): Promise<Run> {
  const recorded = recorder();
  const adminFile = join(directory, "admin.token");
  await writeFile(adminFile, `${options.adminText ?? STUB_ADMIN_TOKEN}\n`, {
    mode: 0o600,
  });
  const lines: string[] = [];
  let code = 0;
  try {
    code = await main(argv, recorded.io, {
      env: environmentOf({
        WAVES_URL: stub.origin,
        WAVES_PROJECT: options.project ?? "waves-leak",
        WAVES_CONFIG_DIR: configDir,
        ...options.vars,
      }),
      input: { read: async () => options.stdin ?? "" },
      clock: { now: () => options.now ?? NOW },
      sleeper: { sleep: async () => undefined },
    });
  } catch (error) {
    lines.push(error instanceof Error ? error.message : String(error));
  }
  return { code, lines: [...lines, ...recorded.out, ...recorded.err] };
}

async function register(project: string, adminText?: string): Promise<Run> {
  const result = await run(
    [
      "register",
      project,
      "--name",
      "Waves Demo",
      "--admin-token-file",
      join(directory, "admin.token"),
    ],
    { project, adminText },
  );
  const issued = stub.tokenOf(project);
  if (issued !== undefined) {
    secrets.add(issued);
  }
  return result;
}

/**
 * `register-all` over a list of the owner's, on the real filesystem and against
 * the stub, which is the only way to see a scheduled run: there is no terminal
 * and no command line to leak anything through.
 */
async function registerAll(
  entries: readonly unknown[],
  extra: readonly string[] = [],
  enrollText = STUB_ENROLL_TOKEN,
): Promise<Run> {
  const recorded = recorder();
  const enrollFile = join(directory, "enroll.token");
  await writeFile(enrollFile, `${enrollText}\n`, { mode: 0o600 });
  await mkdir(configDir, { recursive: true });
  await chmod(configDir, 0o700);
  await writeFile(join(configDir, "projects.json"), JSON.stringify(entries));
  const lines: string[] = [];
  let code = 0;
  try {
    code = await main(
      ["register-all", "--enrollment-token-file", enrollFile, ...extra],
      recorded.io,
      {
        env: environmentOf({
          WAVES_URL: stub.origin,
          WAVES_CONFIG_DIR: configDir,
        }),
        input: { read: async () => "" },
        clock: { now: () => NOW },
        sleeper: { sleep: async () => undefined },
      },
    );
  } catch (error) {
    lines.push(error instanceof Error ? error.message : String(error));
  }
  return { code, lines: [...lines, ...recorded.out, ...recorded.err] };
}

/**
 * `waves sync` over a list of the owner's own collectors, on the real filesystem
 * and against the stub, which is the only way to see a scheduled run: the
 * collectors are real programs, the tokens on disk are real, and there is no
 * terminal and no command line for anything to leak through.
 */
async function syncNow(entries: readonly unknown[]): Promise<Run> {
  const recorded = recorder();
  await mkdir(configDir, { recursive: true });
  await chmod(configDir, 0o700);
  await writeFile(
    join(configDir, "sync.json"),
    JSON.stringify({ projects: entries }),
    { mode: 0o600 },
  );
  const lines: string[] = [];
  let code = 0;
  try {
    code = await main(["sync"], recorded.io, {
      env: environmentOf({
        WAVES_URL: stub.origin,
        WAVES_CONFIG_DIR: configDir,
      }),
      input: { read: async () => "" },
      // A run begins at index floor(now / every) mod n of the file, and this test
      // wants the file's own order.
      clock: { now: () => 0 },
      sleeper: { sleep: async () => undefined },
    });
  } catch (error) {
    lines.push(error instanceof Error ? error.message : String(error));
  }
  return { code, lines: [...lines, ...recorded.out, ...recorded.err] };
}

/** A collector that prints one wave, or fails having printed nothing. */
function collector(body: string): readonly string[] {
  return [process.execPath, "-e", body];
}

function expectNoSecrets(result: Run): void {
  expect(result.lines.length).toBeGreaterThan(0);
  for (const secret of secrets) {
    for (const line of result.lines) {
      expect(line).not.toContain(secret);
    }
  }
}

function tokenFile(project: string): string {
  return join(configDir, `${project}.token`);
}

describe("a token never leaves the file it was written to", () => {
  it("is not printed by a registration that succeeded", async () => {
    const project = "waves-leak-register";
    const registered = await register(project);
    expect(registered.code).toBe(0);
    expectNoSecrets(registered);

    // The token the stub issued is on disk, once, and only there.
    const stored = await readFile(tokenFile(project), "utf8");
    expect(stored).toBe(stub.tokenOf(project));
    for (const line of registered.lines) {
      expect(line).toContain(tokenFile(project));
    }
  });

  it("is not printed by a registration that failed", async () => {
    const refused = await register("waves-leak-admin", "not-the-admin-token");
    expect(refused.code).toBe(1);
    expect(refused.lines).toContain(
      "waves register: register failed: 401 Unauthorized\n  the admin token was refused",
    );
    expectNoSecrets(refused);
  });

  it("is not printed by a push that worked, or by one that did not", async () => {
    const project = "waves-leak-push";
    await register(project);
    const pushed = await run(["push", "--wave", WAVE, "--stdin"], {
      project,
      stdin: LANES,
    });
    expect(pushed.code).toBe(0);
    expectNoSecrets(pushed);

    await chmod(tokenFile(project), 0o640);
    const loose = await run(["push", "--wave", WAVE, "--stdin"], {
      project,
      stdin: LANES,
    });
    expect(loose.code).toBe(2);
    expectNoSecrets(loose);
    await chmod(tokenFile(project), 0o600);

    await writeFile(tokenFile(project), "waves-leak-t0ken-not-mine", {
      mode: 0o600,
    });
    const borrowed = await run(["push", "--wave", WAVE, "--stdin"], {
      project,
      stdin: LANES,
    });
    expect(borrowed.code).toBe(1);
    expectNoSecrets(borrowed);
  });

  it("is not printed by a status, or by one the server refused", async () => {
    const project = "waves-leak-status";
    await register(project);
    const sent = await run(["status", "--stdin"], {
      project,
      stdin: STATUS,
    });
    expect(sent.code).toBe(0);
    expectNoSecrets(sent);

    const refused = await run(["status", "--stdin"], {
      project,
      stdin: '{"backlogg":{"state":"recorded"}}',
    });
    expect(refused.code).toBe(2);
    expectNoSecrets(refused);

    await writeFile(tokenFile(project), "waves-leak-t0ken-not-mine", {
      mode: 0o600,
    });
    const borrowed = await run(["status", "--stdin"], {
      project,
      stdin: STATUS,
    });
    expect(borrowed.code).toBe(1);
    expectNoSecrets(borrowed);
  });

  it("is not printed by a deletion, or by a wave that was never there", async () => {
    const project = "waves-leak-delete";
    await register(project);
    await run(["push", "--wave", WAVE, "--stdin"], { project, stdin: LANES });
    const deleted = await run(["delete", "--wave", WAVE], { project });
    expect(deleted.code).toBe(0);
    expectNoSecrets(deleted);

    const again = await run(["delete", "--wave", WAVE], { project });
    expect(again.code).toBe(1);
    expectNoSecrets(again);
  });

  it("is not printed when the server answers with an error about it", async () => {
    const project = "waves-leak-skew";
    await register(project);
    const skewed = await run(["push", "--wave", WAVE, "--stdin"], {
      project,
      stdin: LANES,
      now: Date.parse("2031-02-03T04:05:06.789Z"),
    });
    expect(skewed.code).toBe(1);
    expectNoSecrets(skewed);
  });

  it("is not printed by a run over a list, or by one that skips it", async () => {
    const project = "waves-leak-all";
    const entries = [
      { id: project, name: "Waves Demo" },
      { id: "waves-leak-later", name: "Waves Later" },
    ];
    const enrolled = await registerAll(entries);
    expect(enrolled.code).toBe(0);
    for (const issued of [project, "waves-leak-later"]) {
      const token = stub.tokenOf(issued);
      if (token !== undefined) {
        secrets.add(token);
      }
    }
    expect(enrolled.lines).toContain(
      "0 skipped, 2 registered, 0 conflicts, 0 failed",
    );
    expectNoSecrets(enrolled);
    for (const line of enrolled.lines) {
      expect(line).not.toContain(STUB_ENROLL_TOKEN);
    }
    expect(await readFile(tokenFile(project), "utf8")).toBe(
      stub.tokenOf(project),
    );

    // The second run has nothing to do, and says so rather than registering the
    // same project again.
    const again = await registerAll(entries, ["--verbose"]);
    expect(again.code).toBe(0);
    expect(again.lines).toContain(
      "2 skipped, 0 registered, 0 conflicts, 0 failed",
    );
    expectNoSecrets(again);
  });

  it("is not printed by a run whose credential the server refused", async () => {
    const refused = await registerAll(
      [{ id: "waves-leak-none", name: "None" }],
      [],
      "not-the-enrollment-token",
    );
    expect(refused.code).toBe(1);
    expect(refused.lines).toContain(
      "waves-leak-none: the server refused the enrollment token for this run, stopping: 401 Unauthorized\n  the admin token was refused",
    );
    expectNoSecrets(refused);
  });

  it("is not printed when the server is not there at all", async () => {
    const project = "waves-leak-lost";
    await register(project);
    const lost = await run(["push", "--wave", WAVE, "--stdin"], {
      project,
      stdin: LANES,
      vars: { WAVES_URL: "http://127.0.0.1:1" },
    });
    expect(lost.code).toBe(1);
    expectNoSecrets(lost);
  });

  it("is not printed when the token file is not there to read", async () => {
    const missing = await run(["push", "--wave", WAVE, "--stdin"], {
      project: "waves-leak-none",
      stdin: LANES,
    });
    expect(missing.code).toBe(2);
    expectNoSecrets(missing);
  });

  it("is not printed when the configuration cannot be used", async () => {
    const insecure = await run(["push", "--wave", WAVE, "--stdin"], {
      project: "waves-leak-config",
      stdin: LANES,
      vars: { WAVES_URL: "http://10.0.0.4:8080" },
    });
    expect(insecure.code).toBe(2);
    expect(insecure.lines[0]).toContain("WAVES_ALLOW_INSECURE_HTTP=1");
    expectNoSecrets(insecure);
  });

  it("is not printed by a scheduled run, or by the projects in it that failed", async () => {
    const failed = "waves-leak-sync-failed";
    const borrowed = "waves-leak-sync-borrowed";
    await register(failed);
    await register(borrowed);
    for (const project of [failed, borrowed]) {
      const issued = stub.tokenOf(project);
      if (issued !== undefined) {
        secrets.add(issued);
      }
    }
    // The second project's token is one this machine did not get from the server,
    // so its wave is refused. The first one's collector fails outright.
    await writeFile(tokenFile(borrowed), "waves-leak-t0ken-not-mine", {
      mode: 0o600,
    });

    const oneWave = `process.stdout.write('${JSON.stringify({
      waves: [{ wave: WAVE, lanes: [] }],
    })}');`;
    const result = await syncNow([
      {
        project: failed,
        command: collector(
          'console.error("the lanes are gone");process.exit(1);',
        ),
        cwd: directory,
      },
      { project: borrowed, command: collector(oneWave), cwd: directory },
    ]);

    expect(result.code).toBe(1);
    expect(result.lines).toContain(
      "waves sync: waves-leak-sync-failed: the collector exited 1: the lanes are gone",
    );
    expect(result.lines).toContain(
      "waves sync: waves-leak-sync-borrowed: push failed: 403 Forbidden\n  that token belongs to another project",
    );
    expectNoSecrets(result);

    // And a run whose configuration is refused has nothing to leak either.
    await chmod(join(configDir, "sync.json"), 0o644);
    const loose = await syncNow([]);
    expect(loose.code).toBe(2);
    expectNoSecrets(loose);
  });
});
