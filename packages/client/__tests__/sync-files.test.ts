import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { main } from "../src/index.js";
import { environmentOf, recorder } from "./support/harness.js";
import { entry, printed, syncFile } from "./support/sync.js";

/**
 * The file rule for `sync.json`, and a collector or two, on a real filesystem.
 *
 * The fake files the rest of the suite uses have no modes and no links, so the
 * only way to see what the adapter does with a `sync.json` that is a link, or one
 * another account can read, or one that is executable, is to write one and run the
 * command against it. It is the same reason `no-leak.test.ts` runs against a real
 * stub server: a scheduled run has no terminal to be tidy about.
 */

let directory: string;
let configDir: string;

beforeEach(async () => {
  // The real path: on macOS `/var` is a link to `/private/var`, and a child
  // reports the directory it runs in by its real path.
  directory = await realpath(await mkdtemp(join(tmpdir(), "waves-sync-")));
  configDir = join(directory, "config");
  await mkdir(configDir, { recursive: true, mode: 0o700 });
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const CONFIG = syncFile([entry("waves-demo")]);

/** One `waves sync` against the real filesystem, and everything it said. */
async function runSync(
  vars: Readonly<Record<string, string | undefined>> = {},
): Promise<{ code: number; err: readonly string[] }> {
  const recorded = recorder();
  const code = await main(["sync"], recorded.io, {
    env: environmentOf({
      WAVES_URL: "http://127.0.0.1:8080",
      WAVES_CONFIG_DIR: configDir,
      PATH: "/usr/local/bin:/usr/bin",
      HOME: directory,
      LANG: "en_GB.UTF-8",
      ...vars,
    }),
    input: { read: async () => "" },
    clock: { now: () => 0 },
    sleeper: { sleep: async () => undefined },
  });
  return { code, err: recorded.err };
}

async function writeConfig(text: string, mode = 0o600): Promise<string> {
  const path = join(configDir, "sync.json");
  await writeFile(path, text, { mode });
  return path;
}

describe("a sync.json the client will not read", () => {
  it("is refused when it is a link, and the refusal names the file", async () => {
    const real = join(directory, "real.json");
    await writeFile(real, CONFIG, { mode: 0o600 });
    await symlink(real, join(configDir, "sync.json"));

    const run = await runSync();
    expect(run.code).toBe(2);
    expect(run.err[0]).toBe(
      `waves sync: ${join(configDir, "sync.json")} is a symbolic link; sync.json must be a regular file`,
    );
  });

  it("is refused when another account can read it", async () => {
    const path = await writeConfig(CONFIG, 0o644);

    const run = await runSync();
    expect(run.code).toBe(2);
    expect(run.err[0]).toBe(
      `waves sync: ${path} is mode 0o644; it must be 0600 or stricter`,
    );
  });

  it("is refused when it is executable, however tight the rest is", async () => {
    const path = await writeConfig(CONFIG, 0o600);
    await chmod(path, 0o700);

    const run = await runSync();
    expect(run.code).toBe(2);
    expect(run.err[0]).toContain("is mode 0o700; it must be 0600 or stricter");
  });

  it("is accepted at 0600, and then the run is the run's own", async () => {
    await writeConfig(CONFIG);
    // Nothing is started here: the collector is a program this test has not
    // written, which is a failure of the project's line rather than of the file.
    const run = await runSync();
    expect(run.code).toBe(1);
    expect(run.err[0]).toContain(`waves sync: waves-demo: `);
  });

  it("names the directory when there is no sync.json in it at all", async () => {
    const run = await runSync();
    expect(run.code).toBe(2);
    expect(run.err).toEqual([`waves sync: no sync.json in ${configDir}`]);
  });
});

describe("a collector this test can really run", () => {
  it("is given only what the file's own project needs", async () => {
    // A collector that prints its own environment and fails, so the whole
    // environment comes back through the run's one line.
    // `__CF_USER_TEXT_ENCODING` is left out: macOS adds it to every process it
    // starts, whatever environment the parent handed over.
    const script = [
      "const seen=Object.keys(process.env).filter((k)=>!k.startsWith('__CF_')).sort().join(',')+';project='+process.env.WAVES_PROJECT;",
      "console.error(seen);",
      "process.exit(1);",
    ].join("");
    await writeConfig(
      syncFile([
        entry("waves-demo", {
          command: [process.execPath, "-e", script],
          cwd: directory,
        }),
      ]),
    );

    const run = await runSync();
    expect(run.code).toBe(1);
    // HOME, LANG, PATH and the project — and neither this client's server nor its
    // config directory, which a collector has no business being handed.
    expect(run.err[0]).toBe(
      "waves sync: waves-demo: the collector exited 1: " +
        `HOME,LANG,PATH,WAVES_PROJECT;project=waves-demo`,
    );
    expect(run.err[0]).not.toContain("WAVES_URL");
    expect(run.err[0]).not.toContain("WAVES_CONFIG_DIR");
    expect(run.err[0]).not.toContain(".token");
  });

  it("leaves out the names this client does not have", async () => {
    await writeConfig(
      syncFile([
        entry("waves-demo", {
          command: [
            process.execPath,
            "-e",
            [
              "console.error(Object.keys(process.env).filter((k)=>!k.startsWith('__CF_')).sort().join(','));",
              "process.exit(1);",
            ].join(""),
          ],
          cwd: directory,
        }),
      ]),
    );

    const run = await runSync({ HOME: undefined, LANG: undefined });
    expect(run.code).toBe(1);
    expect(run.err[0]).toContain("the collector exited 1: PATH,WAVES_PROJECT");
  });

  it("runs in the directory the file names", async () => {
    const working = join(directory, "work");
    await mkdir(working);
    await writeConfig(
      syncFile([
        entry("waves-demo", {
          command: [
            process.execPath,
            "-e",
            "console.error(process.cwd());process.exit(1);",
          ],
          cwd: working,
        }),
      ]),
    );

    const run = await runSync();
    expect(run.code).toBe(1);
    expect(run.err[0]).toContain(`the collector exited 1: ${working}`);
  });
});

describe("a collector that succeeds", () => {
  it("reports a project with no waves, and pushes nothing", async () => {
    await writeConfig(
      syncFile([
        entry("waves-demo", {
          command: [
            process.execPath,
            "-e",
            `process.stdout.write(${JSON.stringify(printed([]))});`,
          ],
          cwd: directory,
        }),
      ]),
    );

    const run = await runSync();
    // The token file is not there, so this project is reported without a server
    // to report it to: a real collector, a real run, and no request at all.
    expect(run.code).toBe(1);
    expect(run.err[0]).toContain("no token for waves-demo at");
  });
});
