import { execFileSync, spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

/**
 * The launchd LaunchAgents, run on Linux with `/bin/sh` and two stubs standing
 * in for the two things the owner's Mac has: `launchctl`, which nothing in CI
 * may call, and a client, whose `register-all` and `sync` are the client
 * package's own.
 *
 * Every case is the same good fixture with at most one thing changed, in a
 * fresh `HOME` with its own config directory, so a refusal is the refusal and
 * not the state a previous case left behind. `LAUNCHCTL` is a shell script that
 * records its arguments, which is how bootout-then-bootstrap is asserted at
 * all: no macOS and no launchd are needed to see the order.
 *
 * The fixture writes no sync.json, so the register-all agent is the only one it
 * installs and its cases pin nothing about the second agent. The sync cases ask
 * for one, with a PATH of their own: install.sh renders the PATH it is run with
 * into the sync plist, and node, the client and launchctl are all absolute
 * through WAVES_NODE, WAVES_CLIENT and LAUNCHCTL, so a pinned PATH is the only
 * honest one there.
 *
 * The token is a string the fixture writes, and one case asserts that no
 * rendered file, no record and no output ever holds it. That is the whole
 * reason these scripts are on the owner's machine rather than in a container.
 */

const LAUNCHD = fileURLToPath(
  new URL("../../../deploy/launchd/", import.meta.url),
);
const INSTALL = `${LAUNCHD}install.sh`;
const UNINSTALL = `${LAUNCHD}uninstall.sh`;
const WRAPPER_TEMPLATE = `${LAUNCHD}register-all.sh.template`;
const PLIST_TEMPLATE = `${LAUNCHD}cloud.krakowski.waves.register-all.plist.template`;
const SYNC_WRAPPER_TEMPLATE = `${LAUNCHD}sync.sh.template`;
const SYNC_PLIST_TEMPLATE = `${LAUNCHD}cloud.krakowski.waves.sync.plist.template`;

const LABEL = "cloud.krakowski.waves.register-all";
const SYNC_LABEL = "cloud.krakowski.waves.sync";
const GOOD_URL = "https://waves.midnight.lan";

/** A fixture value, not a credential: 60 characters of the token character set. */
const TOKEN_VALUE =
  "waves-enrollment-token-value-4d1f9a6c2b8e0f35a7c4d9b1e6f20a83";

/** The PATH a sync case runs install.sh with: two directories, a colon, no more. */
const PINNED_PATH = "/usr/bin:/bin";

/** `process.getuid()` is optional in the types; `id -u` is the same number. */
const UID = execFileSync("id", ["-u"]).toString().trim();

/**
 * A sync.json the client's own reader would take, with `every` as the caller
 * wants it: a number, a string, a float, or no key at all, which is a file that
 * takes the default. It is a fixture, not a program anyone runs, so its
 * collector is a path that is not there.
 */
function syncJson(every?: unknown): string {
  const projects = [
    { project: "waves", command: ["/nowhere/collector"], cwd: "/nowhere" },
  ];
  return `${JSON.stringify(
    every === undefined ? { projects } : { every, projects },
  )}\n`;
}

/** A file the scripts or the stubs wrote, named for the assertion that reads it. */
type Written =
  | "wrapper"
  | "plist"
  | "log"
  | "syncWrapper"
  | "syncPlist"
  | "syncLog"
  | "record"
  | "argv";

interface World {
  readonly root: string;
  readonly home: string;
  readonly token: string;
  readonly node: string;
  readonly client: string;
  readonly wrapper: string;
  readonly plist: string;
  readonly log: string;
  readonly syncConfig: string;
  readonly syncWrapper: string;
  readonly syncPlist: string;
  readonly syncLog: string;
  readonly files: Readonly<Record<Written, string>>;
  run(
    script: string,
    args: readonly string[],
    overrides?: Readonly<Record<string, string>>,
  ): SpawnSyncReturns<string>;
  env(overrides?: Readonly<Record<string, string>>): NodeJS.ProcessEnv;
  calls(): readonly string[];
  mode(path: string): string;
}

/** What a case may change about the fixture. */
interface WorldOptions {
  /** A home under a name the scripts would have to quote. */
  readonly homeName?: string;
  /** A sync.json to write, whole. No `sync` key, the fixture writes none. */
  readonly sync?: string;
  /** The environment every run in this world starts from. */
  readonly env?: Readonly<Record<string, string>>;
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0, roots.length)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/**
 * A `launchctl` that answers every subcommand with exit 0 and records its
 * arguments, one line per call. `bootstrap-failures` in the same directory, if
 * it is there, is the number of `bootstrap` calls to fail first — macOS
 * answers "Bootstrap failed: 37/5" for a moment when a bootout is still
 * draining, which is what the retry in install.sh is for.
 */
const LAUNCHCTL_STUB = `#!/bin/sh
here=$(CDPATH= cd "$(dirname "$0")" && pwd)
printf '%s\\n' "$*" >>"$here/record"
if [ "\${1:-}" = bootstrap ] && [ -f "$here/bootstrap-failures" ]; then
  seen=$(cat "$here/seen" 2>/dev/null || echo 0)
  seen=$((seen + 1))
  printf '%s' "$seen" >"$here/seen"
  if [ "$seen" -le "$(cat "$here/bootstrap-failures")" ]; then
    printf 'Bootstrap failed: 37/5\\n' >&2
    exit 1
  fi
fi
exit 0
`;

/**
 * The client, as Node sees it: `help` exits 0 so install.sh's check that the
 * pinned pair runs passes, and anything else is recorded argv by argv. The
 * package.json beside it pins CommonJS, so the stub parses the same way
 * wherever the temporary directory happens to be.
 */
const CLIENT_STUB = `const { appendFileSync } = require("node:fs");
const { join } = require("node:path");

if (process.argv[2] !== "help") {
  appendFileSync(
    join(__dirname, "argv"),
    \`\${JSON.stringify(process.argv.slice(2))}\\n\`,
  );
}
process.exit(0);
`;

function world(options: WorldOptions = {}): World {
  const root = mkdtempSync(join(tmpdir(), "waves-launchd-"));
  roots.push(root);
  const home = join(root, options.homeName ?? "home");
  const config = join(root, "config");
  const bin = join(root, "bin");
  for (const directory of [home, config, bin]) {
    mkdirSync(directory, { recursive: true });
  }
  // The client refuses a directory of tokens anyone else can reach.
  chmodSync(config, 0o700);

  const token = join(config, "enroll.token");
  writeFileSync(token, `${TOKEN_VALUE}\n`);
  chmodSync(token, 0o600);

  // The sync agent is only ever installed when there is a sync.json, and the
  // client reads that file under the token file's own rule, so it is written at
  // the token's mode.
  const syncConfig = join(config, "sync.json");
  if (options.sync !== undefined) {
    writeFileSync(syncConfig, options.sync);
    chmodSync(syncConfig, 0o600);
  }

  writeFileSync(join(bin, "package.json"), '{ "type": "commonjs" }\n');
  const client = join(bin, "client.js");
  writeFileSync(client, CLIENT_STUB);
  const launchctl = join(bin, "launchctl");
  writeFileSync(launchctl, LAUNCHCTL_STUB, { mode: 0o755 });

  const support = join(home, "Library/Application Support/waves");
  const agents = join(home, "Library/LaunchAgents");
  const wrapper = join(support, "register-all.sh");
  const plist = join(agents, `${LABEL}.plist`);
  const log = join(home, "Library/Logs/waves-register-all.log");
  const syncWrapper = join(support, "sync.sh");
  const syncPlist = join(agents, `${SYNC_LABEL}.plist`);
  const syncLog = join(home, "Library/Logs/waves-sync.log");
  const files: Record<Written, string> = {
    wrapper,
    plist,
    log,
    syncWrapper,
    syncPlist,
    syncLog,
    record: join(bin, "record"),
    argv: join(bin, "argv"),
  };

  const env = (
    overrides: Readonly<Record<string, string>> = {},
  ): NodeJS.ProcessEnv => ({
    ...process.env,
    HOME: home,
    WAVES_CONFIG_DIR: config,
    WAVES_NODE: process.execPath,
    WAVES_CLIENT: client,
    LAUNCHCTL: launchctl,
    ...options.env,
    ...overrides,
  });

  return {
    root,
    home,
    token,
    node: process.execPath,
    client,
    wrapper,
    plist,
    log,
    syncConfig,
    syncWrapper,
    syncPlist,
    syncLog,
    files,
    env,
    run: (script, args, overrides) =>
      spawnSync("/bin/sh", [script, ...args], {
        encoding: "utf8",
        env: env(overrides),
      }),
    calls: () => {
      const record = files.record;
      if (!existsSync(record)) {
        return [];
      }
      return readFileSync(record, "utf8")
        .split("\n")
        .filter((line) => line !== "");
    },
    mode,
  };
}

/**
 * A world for the sync cases: a PATH of its own, since install.sh renders the
 * PATH it is run with into the sync plist, and node, the client and launchctl
 * are absolute through the seams, so two directories are enough. A case with no
 * `sync` in its options has no sync.json, which is itself the case that the sync
 * agent is not installed.
 */
function syncWorld(options: WorldOptions = {}): World {
  return world({
    ...options,
    env: { PATH: PINNED_PATH, ...options.env },
  });
}

/** The three permission bits, as `stat` would print them on either platform. */
function mode(path: string): string {
  return (statSync(path).mode & 0o777).toString(8).padStart(3, "0");
}

/** The template with its placeholders filled in, built here and not copied. */
function render(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  return Object.entries(values).reduce(
    (text, [placeholder, value]) => text.replaceAll(placeholder, value),
    readFileSync(template, "utf8"),
  );
}

function text(path: string): string {
  return readFileSync(path, "utf8");
}

/** The files the scripts and the stubs wrote, with the name each is read by. */
function written(w: World): readonly (readonly [Written, string])[] {
  return (Object.keys(w.files) as Written[])
    .filter((name) => existsSync(w.files[name]))
    .map((name) => [name, text(w.files[name])]);
}

/** Every refusal is the same shape: one line on stderr naming it, and nothing loaded. */
function refusal(w: World, args: readonly string[], word: string): void {
  const result = w.run(INSTALL, args);
  expect(result.status, result.stderr).toBe(2);
  expect(result.stderr).toContain(word);
  expect(existsSync(w.plist), "a refusal renders no plist").toBe(false);
}

/**
 * A refusal over the sync configuration is a refusal of the whole install: there
 * is no half of one script rendered and no agent loaded, so this holds both
 * agents' files and the empty call list.
 */
function syncRefusal(
  w: World,
  word: string,
  overrides?: Readonly<Record<string, string>>,
): void {
  const result = w.run(INSTALL, [GOOD_URL], overrides);
  expect(result.status, result.stderr).toBe(2);
  expect(result.stderr).toContain(word);
  expect(existsSync(w.plist), "a refusal renders no plist").toBe(false);
  expect(existsSync(w.syncPlist), "a refusal renders no sync plist").toBe(
    false,
  );
  expect(w.calls(), "a refusal loads nothing").toEqual([]);
}

/** `count` lines of a run's worth of log, numbered from one. */
function numberedLines(count: number): string {
  return `${Array.from({ length: count }, (_, at) => `run ${at + 1}`).join("\n")}\n`;
}

/** The log's lines, without the empty one a trailing newline leaves. */
function logLines(path: string): readonly string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line !== "");
}

/**
 * The sync run as launchd makes it: stdout and stderr are the log itself, opened
 * on it in append mode, because that is the descriptor launchd opened before it
 * started this script and will not open again. A wrapper that shortened the log
 * by renaming a new file over it would leave this run writing to an inode with
 * no name, and the owner reading a file this run never touched.
 */
function runOnTheLog(w: World): SpawnSyncReturns<Buffer> {
  const descriptor = openSync(w.syncLog, "a");
  try {
    return spawnSync("/bin/sh", [w.syncWrapper], {
      env: w.env({ WAVES_URL: GOOD_URL }),
      stdio: ["ignore", descriptor, descriptor],
    });
  } finally {
    closeSync(descriptor);
  }
}

describe("install.sh", { timeout: 20_000 }, () => {
  it("renders both templates and boots the agent out and back in", () => {
    const w = world();
    const result = w.run(INSTALL, [GOOD_URL]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");

    // The wrapper is 0700 because it holds the token's path and a PATH, and the
    // plist is 0644 because launchd reads it as the user, not as root.
    expect(w.mode(w.wrapper)).toBe("700");
    expect(w.mode(w.plist)).toBe("644");
    // The log is made here, at 0600 under the umask, rather than left to
    // launchd, which would make it world-readable.
    expect(w.mode(w.log)).toBe("600");

    expect(text(w.wrapper)).toBe(
      render(WRAPPER_TEMPLATE, {
        "@NODE@": w.node,
        "@CLIENT@": w.client,
        "@TOKEN@": w.token,
      }),
    );
    expect(text(w.plist)).toBe(
      render(PLIST_TEMPLATE, {
        "@URL@": GOOD_URL,
        "@WRAPPER@": w.wrapper,
        "@LOG@": w.log,
        "@CONFIG@": dirname(w.token),
      }),
    );

    // The token's path is what the wrapper holds. Its value is nowhere.
    expect(text(w.wrapper)).toContain(w.token);
    expect(text(w.wrapper)).not.toContain(TOKEN_VALUE);

    // bootout before bootstrap, so a second run replaces the loaded agent
    // rather than failing to add one that is already there.
    expect(w.calls()).toEqual([
      `bootout gui/${UID}/${LABEL}`,
      `bootstrap gui/${UID} ${w.plist}`,
    ]);

    // The summary names the paths it installed and the pinned pair, and never
    // the token's path or value.
    expect(result.stdout).toContain(w.wrapper);
    expect(result.stdout).toContain(w.plist);
    expect(result.stdout).toContain(w.log);
    expect(result.stdout).toContain(w.node);
    expect(result.stdout).toContain(w.client);
    expect(result.stdout).toContain("node upgrade");
    expect(result.stdout).not.toContain(w.token);
  });

  it.each([
    "https://waves.midnight.lan/api",
    "https://waves.midnight.lan?a=1&b=2",
    "https://waves.midnight.lan:443:1",
    "https://",
  ])("refuses %s, which is not an origin the client would take", (url) => {
    refusal(world(), [url], "origin");
  });

  it("accepts an origin with a port and a trailing slash", () => {
    const w = world();
    const url = "https://waves.midnight.lan:8443/";
    expect(w.run(INSTALL, [url]).status).toBe(0);
    expect(text(w.plist)).toContain(`<string>${url}</string>`);
  });

  it("hands the scheduled run the config directory it was installed with", () => {
    const w = world();
    expect(w.run(INSTALL, [GOOD_URL]).status).toBe(0);
    expect(text(w.plist)).toContain(
      `<key>WAVES_CONFIG_DIR</key>\n      <string>${dirname(w.token)}</string>`,
    );
  });

  it("refuses a config directory other people can reach", () => {
    const w = world();
    chmodSync(dirname(w.token), 0o755);
    refusal(w, [GOOD_URL], "chmod 700");
  });

  it("refuses a config directory that is a link", () => {
    const w = world();
    const real = `${dirname(w.token)}-real`;
    renameSync(dirname(w.token), real);
    symlinkSync(real, dirname(w.token));
    refusal(w, [GOOD_URL], "not a link");
  });

  it("refuses no argument", () => {
    refusal(world(), [], "argument");
  });

  it("refuses a second argument", () => {
    refusal(world(), [GOOD_URL, GOOD_URL], "argument");
  });

  it("refuses an http URL", () => {
    refusal(world(), ["http://waves.midnight.lan"], "https");
  });

  it("refuses a URL holding a character the plist cannot take", () => {
    refusal(world(), ["https://waves.midnight.lan/<x>"], "character");
  });

  it("refuses a URL longer than 200 characters", () => {
    refusal(
      world(),
      [`https://waves.midnight.lan/${"p".repeat(200)}`],
      "character",
    );
  });

  it("refuses a missing token file", () => {
    const w = world();
    rmSync(w.token);
    refusal(w, [GOOD_URL], "token");
  });

  it("refuses a token file other people can read", () => {
    const w = world();
    chmodSync(w.token, 0o644);
    refusal(w, [GOOD_URL], "mode");
  });

  it("accepts a token file of mode 0400", () => {
    const w = world();
    chmodSync(w.token, 0o400);
    const result = w.run(INSTALL, [GOOD_URL]);

    expect(result.status, result.stderr).toBe(0);
    expect(text(w.wrapper)).toContain(w.token);
  });

  it("refuses a symbolic link in place of the token file", () => {
    const w = world();
    // The link and the file it points at are both 0600, so a check that only
    // asked the mode would take this for the real thing.
    const elsewhere = join(w.root, "elsewhere.token");
    renameSync(w.token, elsewhere);
    chmodSync(elsewhere, 0o600);
    symlinkSync(elsewhere, w.token);
    refusal(w, [GOOD_URL], "symbolic");
  });

  it("refuses a client that is not there", () => {
    const w = world();
    const outcome = spawnSync("/bin/sh", [INSTALL, GOOD_URL], {
      encoding: "utf8",
      env: w.env({ WAVES_CLIENT: join(w.root, "gone.js") }),
    });

    expect(outcome.status, outcome.stderr).toBe(2);
    expect(outcome.stderr).toContain("client");
    expect(existsSync(w.plist)).toBe(false);
  });

  it("refuses a path install.sh would have to quote", () => {
    // A home with an apostrophe in it is a real home, and the rendered wrapper
    // is a shell script that names its own paths. Quoting it would work here
    // and in the plist, so the script refuses it and the owner moves the home
    // or points WAVES_CONFIG_DIR elsewhere.
    const w = world({ homeName: "o'brien" });
    refusal(w, [GOOD_URL], "path");
  });

  it("refuses a URL with a newline in it, though the newline is its only stranger", () => {
    // A command substitution strips a trailing newline, so a check that read
    // the leftover characters back would see nothing left and let it through.
    refusal(world(), ["https://waves.example\nnext"], "character");
  });

  it("refuses a home with a newline in it, and leaves no half-rendered file", () => {
    const w = world({ homeName: "two\nlines" });
    refusal(w, [GOOD_URL], "path");
    expect(existsSync(join(dirname(w.wrapper), ".register-all.sh.tmp"))).toBe(
      false,
    );
  });

  it("is idempotent, and boots the agent out and back in each time", () => {
    const w = world();
    expect(w.run(INSTALL, [GOOD_URL]).status).toBe(0);
    const wrapper = text(w.wrapper);
    const plist = text(w.plist);

    expect(w.run(INSTALL, [GOOD_URL]).status).toBe(0);

    expect(text(w.wrapper)).toBe(wrapper);
    expect(text(w.plist)).toBe(plist);
    expect(w.calls()).toEqual([
      `bootout gui/${UID}/${LABEL}`,
      `bootstrap gui/${UID} ${w.plist}`,
      `bootout gui/${UID}/${LABEL}`,
      `bootstrap gui/${UID} ${w.plist}`,
    ]);
    // Nothing is left behind in either directory: each render goes to a
    // temporary name and is moved within the directory it belongs in.
    expect(readdirSync(join(w.home, "Library/LaunchAgents"))).toEqual([
      `${LABEL}.plist`,
    ]);
    expect(
      readdirSync(join(w.home, "Library/Application Support/waves")),
    ).toEqual(["register-all.sh"]);
  });

  it("retries bootstrap while the previous agent drains", () => {
    const w = world();
    // macOS answers "Bootstrap failed: 37/5" when a bootout is still draining,
    // so a single attempt would make a re-run after a node upgrade look broken.
    writeFileSync(join(w.root, "bin/bootstrap-failures"), "2");
    const result = w.run(INSTALL, [GOOD_URL]);

    expect(result.status, result.stderr).toBe(0);
    expect(w.calls()).toEqual([
      `bootout gui/${UID}/${LABEL}`,
      `bootstrap gui/${UID} ${w.plist}`,
      `bootstrap gui/${UID} ${w.plist}`,
      `bootstrap gui/${UID} ${w.plist}`,
    ]);
  });

  it("refuses when bootstrap keeps failing", () => {
    const w = world();
    writeFileSync(join(w.root, "bin/bootstrap-failures"), "99");
    const result = w.run(INSTALL, [GOOD_URL]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("bootstrap");
    expect(
      w.calls().filter((call) => call.startsWith("bootstrap")),
    ).toHaveLength(5);
  });
});

describe("the sync agent", { timeout: 20_000 }, () => {
  it("is installed when there is a sync.json, on its every and the install's PATH", () => {
    const w = syncWorld({ sync: syncJson(30) });
    const result = w.run(INSTALL, [GOOD_URL]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe("");

    // The modes are register-all's, for register-all's reasons: the wrapper is
    // 0700, the plist 0644 because launchd reads it as the user, and the log is
    // made here at 0600 rather than left to launchd, which would make it 0644.
    expect(w.mode(w.syncWrapper)).toBe("700");
    expect(w.mode(w.syncPlist)).toBe("644");
    expect(w.mode(w.syncLog)).toBe("600");

    expect(text(w.syncWrapper)).toBe(
      render(SYNC_WRAPPER_TEMPLATE, {
        "@NODE@": w.node,
        "@CLIENT@": w.client,
        "@LOG@": w.syncLog,
      }),
    );
    expect(text(w.syncPlist)).toBe(
      render(SYNC_PLIST_TEMPLATE, {
        "@URL@": GOOD_URL,
        "@WRAPPER@": w.syncWrapper,
        "@LOG@": w.syncLog,
        "@CONFIG@": dirname(w.syncConfig),
        "@PATH@": PINNED_PATH,
        "@EVERY@": "30",
      }),
    );

    // Both periods are `every`: launchd is the timer, and ThrottleInterval is
    // what keeps a slow run from being started again on top of itself.
    expect(text(w.syncPlist)).toContain(
      "<key>StartInterval</key>\n    <integer>30</integer>",
    );
    expect(text(w.syncPlist)).toContain(
      "<key>ThrottleInterval</key>\n    <integer>30</integer>",
    );
    // launchd's own PATH is /usr/bin:/bin:/usr/sbin:/sbin, so the agent carries
    // the one the install ran with: a collector that calls node or gh out of nvm
    // or Homebrew would fail under the agent and pass by hand.
    expect(text(w.syncPlist)).toContain(
      `<key>PATH</key>\n      <string>${PINNED_PATH}</string>`,
    );
    expect(text(w.syncPlist)).toContain(
      `<key>WAVES_CONFIG_DIR</key>\n      <string>${dirname(w.syncConfig)}</string>`,
    );

    // Each agent is booted out and back in on its own, register-all first.
    expect(w.calls()).toEqual([
      `bootout gui/${UID}/${LABEL}`,
      `bootstrap gui/${UID} ${w.plist}`,
      `bootout gui/${UID}/${SYNC_LABEL}`,
      `bootstrap gui/${UID} ${w.syncPlist}`,
    ]);

    // The summary names the two files it wrote, the period it read and the bound
    // it keeps on the log.
    expect(result.stdout).toContain(SYNC_LABEL);
    expect(result.stdout).toContain(w.syncWrapper);
    expect(result.stdout).toContain(w.syncPlist);
    expect(result.stdout).toContain(w.syncLog);
    expect(result.stdout).toContain("30 seconds");
    expect(result.stdout).toContain("last 1000 lines");
  });

  it("is not installed without a sync.json, and says which directory it looked in", () => {
    const w = syncWorld();
    const result = w.run(INSTALL, [GOOD_URL]);

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(w.syncPlist)).toBe(false);
    expect(existsSync(w.syncWrapper)).toBe(false);
    expect(existsSync(w.syncLog)).toBe(false);
    expect(result.stdout).toContain(
      `no sync.json in ${dirname(w.syncConfig)}; the sync agent is not installed`,
    );
    // Nothing is booted out for an agent this machine never had, which is what
    // keeps the register-all call list exactly what it was.
    expect(w.calls()).toEqual([
      `bootout gui/${UID}/${LABEL}`,
      `bootstrap gui/${UID} ${w.plist}`,
    ]);
  });

  it("takes a sync.json with no every as the client's own default of 60", () => {
    // `every` is optional, and the client defaults it to 60: an install that
    // made a default of its own would schedule a different period from the one
    // waves sync writes into every wave it pushes.
    const w = syncWorld({ sync: syncJson() });
    expect(w.run(INSTALL, [GOOD_URL]).status).toBe(0);

    expect(text(w.syncPlist)).toContain(
      "<key>StartInterval</key>\n    <integer>60</integer>",
    );
    expect(text(w.syncPlist)).toContain(
      "<key>ThrottleInterval</key>\n    <integer>60</integer>",
    );
  });

  it.each([5, 101])("refuses an every of %s, outside 10 to 100", (every) => {
    syncRefusal(syncWorld({ sync: syncJson(every) }), "10 to 100");
  });

  // `every` is the client's key with the client's rules, and the program that
  // reads it refuses what the client would refuse: a file waves sync cannot use
  // is not one to schedule a timer around.
  it.each(["x", 60.5])(
    "refuses an every of %s, which is no whole number of seconds",
    (every) => {
      syncRefusal(syncWorld({ sync: syncJson(every) }), "could not use");
    },
  );

  it("refuses a period that is no number of seconds in any shell", () => {
    // 1e21 is a whole number in JSON and prints as 1e+21, so it is the case
    // that reaches the shell's own check rather than node's.
    syncRefusal(syncWorld({ sync: syncJson(1e21) }), "whole number");
  });

  it("refuses a period too long for a shell to compare, before it compares it", () => {
    // 1e20 is a whole number in JSON too, and prints as twenty-one digits.
    // `test -lt` does not answer on a number that long — it fails, both halves of
    // the `||` fail, and a failed `if` is a false one — so without the length
    // asked first this value would be rendered into StartInterval and the agent
    // bootstrapped, on a period the client refuses.
    syncRefusal(syncWorld({ sync: syncJson(1e20) }), "10 to 100");
  });

  it("refuses a sync.json that is not JSON, with the client's own reason", () => {
    syncRefusal(syncWorld({ sync: "{\n" }), "could not use");
  });

  it("refuses a sync.json other people can read", () => {
    const w = syncWorld({ sync: syncJson() });
    chmodSync(w.syncConfig, 0o644);
    syncRefusal(w, "mode");
  });

  it("refuses a symbolic link in place of the sync.json", () => {
    const w = syncWorld({ sync: syncJson() });
    // The link and the file it points at are both 0600, so a check that only
    // asked the mode would take this for the real thing.
    const elsewhere = join(w.root, "elsewhere.json");
    renameSync(w.syncConfig, elsewhere);
    chmodSync(elsewhere, 0o600);
    symlinkSync(elsewhere, w.syncConfig);
    syncRefusal(w, "symbolic");
  });

  it("refuses a PATH holding a character the plist could not take", () => {
    // The PATH is rendered into XML and into no wrapper, and the rule for
    // anything rendered is the same one the URL is held to: refused, not
    // escaped, so a home or a PATH nobody could quote is answered by install.sh.
    syncRefusal(syncWorld({ sync: syncJson() }), "character", {
      PATH: "/usr/bin:/bin:/opt/a*b",
    });
  });

  it("takes a stale sync agent away when its sync.json is gone", () => {
    const w = syncWorld({ sync: syncJson() });
    expect(w.run(INSTALL, [GOOD_URL]).status).toBe(0);
    expect(existsSync(w.syncPlist)).toBe(true);

    rmSync(w.syncConfig);
    const result = w.run(INSTALL, [GOOD_URL]);

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(w.syncPlist)).toBe(false);
    expect(existsSync(w.syncWrapper)).toBe(false);
    // The log is left: it is the record of every run that did happen.
    expect(existsSync(w.syncLog)).toBe(true);
    expect(result.stdout).toContain(
      `no sync.json in ${dirname(w.syncConfig)}; the sync agent is not installed`,
    );
    expect(result.stdout).toContain("booted out");
    // Only the stale agent's own bootout is added to the call list, after
    // register-all has been replaced exactly as it is on every run.
    expect(w.calls()).toEqual([
      `bootout gui/${UID}/${LABEL}`,
      `bootstrap gui/${UID} ${w.plist}`,
      `bootout gui/${UID}/${SYNC_LABEL}`,
      `bootstrap gui/${UID} ${w.syncPlist}`,
      `bootout gui/${UID}/${LABEL}`,
      `bootstrap gui/${UID} ${w.plist}`,
      `bootout gui/${UID}/${SYNC_LABEL}`,
    ]);
  });

  it("is idempotent, and leaves both agents' files and no temporary names", () => {
    const w = syncWorld({ sync: syncJson() });
    expect(w.run(INSTALL, [GOOD_URL]).status).toBe(0);
    const wrapper = text(w.syncWrapper);
    const plist = text(w.syncPlist);

    expect(w.run(INSTALL, [GOOD_URL]).status).toBe(0);

    expect(text(w.syncWrapper)).toBe(wrapper);
    expect(text(w.syncPlist)).toBe(plist);
    expect(readdirSync(join(w.home, "Library/LaunchAgents")).sort()).toEqual([
      `${LABEL}.plist`,
      `${SYNC_LABEL}.plist`,
    ]);
    expect(
      readdirSync(join(w.home, "Library/Application Support/waves")).sort(),
    ).toEqual(["register-all.sh", "sync.sh"]);
  });
});

describe("the rendered wrapper", { timeout: 20_000 }, () => {
  it("runs the client with the token's path and says so once", () => {
    const w = world();
    expect(w.run(INSTALL, [GOOD_URL]).status).toBe(0);

    // The plist's EnvironmentVariables, so the wrapper runs as launchd runs it.
    const result = spawnSync("/bin/sh", [w.wrapper], {
      encoding: "utf8",
      env: w.env({ WAVES_URL: GOOD_URL }),
    });

    // One dated line per run, so an hour of silence is a thing the log can show
    // happened rather than a thing the owner has to infer.
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z waves register-all: run\n$/,
    );
    // The client is given the path and reads the token, so the token never
    // reaches this script's output or its process arguments.
    expect(text(w.files.argv)).toBe(
      `${JSON.stringify(["register-all", "--enrollment-token-file", w.token])}\n`,
    );
  });

  it("names the path and install.sh when the client is gone, and exits 1", () => {
    // An nvm upgrade moves the node and the client's bin together. A wrapper
    // that only said nothing would leave the owner with an hourly silence and
    // nothing to act on.
    const w = world();
    expect(w.run(INSTALL, [GOOD_URL]).status).toBe(0);
    rmSync(w.client);

    const result = spawnSync("/bin/sh", [w.wrapper], {
      encoding: "utf8",
      env: w.env(),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(w.client);
    expect(result.stderr).toContain("install.sh");
    expect(result.stderr.trimEnd().split("\n")).toHaveLength(1);
    // The client is never reached, so nothing was asked of it.
    expect(existsSync(w.files.argv)).toBe(false);
  });
});

describe("the sync wrapper", { timeout: 20_000 }, () => {
  it("runs waves sync, once, and says so in one dated line", () => {
    const w = syncWorld({ sync: syncJson() });
    expect(w.run(INSTALL, [GOOD_URL]).status).toBe(0);

    // The plist's EnvironmentVariables, so the wrapper runs as launchd runs it.
    const result = spawnSync("/bin/sh", [w.syncWrapper], {
      encoding: "utf8",
      env: w.env({ WAVES_URL: GOOD_URL }),
    });

    // One dated line per run, so a minute of silence is a thing the log can show
    // happened rather than a thing the owner has to infer.
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z waves sync: run\n$/,
    );
    // One run and no arguments: the projects are in sync.json, and the token is
    // read by the client from the config directory the plist names.
    expect(text(w.files.argv)).toBe(`${JSON.stringify(["sync"])}\n`);
  });

  it("names the path and install.sh when the client is gone, and exits 1", () => {
    // An nvm upgrade moves the node and the client's bin together. A wrapper
    // that only said nothing would leave the owner with a minute of silence and
    // nothing to act on.
    const w = syncWorld({ sync: syncJson() });
    expect(w.run(INSTALL, [GOOD_URL]).status).toBe(0);
    rmSync(w.client);

    const result = spawnSync("/bin/sh", [w.syncWrapper], {
      encoding: "utf8",
      env: w.env({ WAVES_URL: GOOD_URL }),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(w.client);
    expect(result.stderr).toContain("install.sh");
    expect(result.stderr.trimEnd().split("\n")).toHaveLength(1);
    expect(existsSync(w.files.argv)).toBe(false);
  });

  it("shortens a log of 6000 lines to its last 1000, in the file it is in", () => {
    // launchd only ever appends to that log and never rotates it, so a run a
    // minute that prints a line would grow it for as long as the machine is on.
    const w = syncWorld({ sync: syncJson() });
    expect(w.run(INSTALL, [GOOD_URL]).status).toBe(0);
    writeFileSync(w.syncLog, numberedLines(6000));
    const before = statSync(w.syncLog);

    const result = runOnTheLog(w);

    // The log is this run's stderr, so it is the message a failure can carry.
    expect(result.status, text(w.syncLog)).toBe(0);
    const kept = logLines(w.syncLog);
    // The last 1000 lines, this run's two lines after them, and nothing before.
    expect(kept).toHaveLength(1002);
    expect(kept[0]).toBe("run 5001");
    expect(kept).not.toContain("run 5000");
    expect(kept[1000]).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z waves sync: the log was 6000 lines; kept its last 1000$/,
    );
    expect(kept[1001]).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z waves sync: run$/,
    );
    // The same file, not a new one: launchd opened this run's stdout on it, and
    // the mode is the one install.sh set, 0600 under its umask.
    expect(statSync(w.syncLog).ino).toBe(before.ino);
    expect(w.mode(w.syncLog)).toBe("600");
  });

  it("leaves a log of 100 lines alone", () => {
    // The bound is over 5000 lines, not over any: a log short enough to read is
    // short enough to keep.
    const w = syncWorld({ sync: syncJson() });
    expect(w.run(INSTALL, [GOOD_URL]).status).toBe(0);
    writeFileSync(w.syncLog, numberedLines(100));

    const result = runOnTheLog(w);

    expect(result.status, text(w.syncLog)).toBe(0);
    const kept = logLines(w.syncLog);
    expect(kept).toHaveLength(101);
    expect(kept[0]).toBe("run 1");
    expect(kept[100]).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z waves sync: run$/,
    );
    expect(kept.join("\n")).not.toContain("last 1000");
  });
});

describe("uninstall.sh", { timeout: 20_000 }, () => {
  it("takes the agent out and removes what it installed, and nothing else", () => {
    const w = world();
    expect(w.run(INSTALL, [GOOD_URL]).status).toBe(0);

    const result = w.run(UNINSTALL, []);

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(w.plist)).toBe(false);
    expect(existsSync(w.wrapper)).toBe(false);
    expect(w.calls()).toContain(`bootout gui/${UID}/${LABEL}`);

    // The log is the only record of what the runs did, and the token file is
    // the credential: both are the owner's, and neither is this script's.
    expect(existsSync(w.log)).toBe(true);
    expect(existsSync(w.token)).toBe(true);
    expect(result.stdout).toContain(w.log);
    expect(result.stdout).toContain("kept");
  });

  it("succeeds when the agent was never installed", () => {
    const w = world();
    const result = w.run(UNINSTALL, []);

    expect(result.status, result.stderr).toBe(0);
    expect(w.calls()).toEqual([`bootout gui/${UID}/${LABEL}`]);
  });

  it("takes both agents out when both are installed, and keeps both logs", () => {
    const w = syncWorld({ sync: syncJson() });
    expect(w.run(INSTALL, [GOOD_URL]).status).toBe(0);

    const result = w.run(UNINSTALL, []);

    expect(result.status, result.stderr).toBe(0);
    for (const file of [w.plist, w.wrapper, w.syncPlist, w.syncWrapper]) {
      expect(existsSync(file), file).toBe(false);
    }
    // Each agent is booted out once by the uninstall, and the sync one is booted
    // out at all because its plist was there to say there was one.
    expect(w.calls()).toEqual([
      `bootout gui/${UID}/${LABEL}`,
      `bootstrap gui/${UID} ${w.plist}`,
      `bootout gui/${UID}/${SYNC_LABEL}`,
      `bootstrap gui/${UID} ${w.syncPlist}`,
      `bootout gui/${UID}/${LABEL}`,
      `bootout gui/${UID}/${SYNC_LABEL}`,
    ]);
    // The logs are the record of every run, and sync.json is the configuration
    // the agent would be installed from again: none of them is this script's.
    expect(existsSync(w.log)).toBe(true);
    expect(existsSync(w.syncLog)).toBe(true);
    expect(existsSync(w.token)).toBe(true);
    expect(existsSync(w.syncConfig)).toBe(true);
    expect(result.stdout).toContain(w.log);
    expect(result.stdout).toContain(w.syncLog);
    expect(result.stdout).toContain("sync.json");
  });

  it("says it booted nothing out when there is no sync plist", () => {
    // Nothing is booted out for an agent this machine never had, which is what
    // keeps the register-all call list unchanged.
    const w = world();
    expect(w.run(INSTALL, [GOOD_URL]).status).toBe(0);

    const result = w.run(UNINSTALL, []);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      `no ${SYNC_LABEL}.plist was there, so no agent was booted out`,
    );
    expect(w.calls()).toEqual([
      `bootout gui/${UID}/${LABEL}`,
      `bootstrap gui/${UID} ${w.plist}`,
      `bootout gui/${UID}/${LABEL}`,
    ]);
  });

  it("removes a sync wrapper an interrupted install left with no plist", () => {
    // install.sh renames the wrapper and then the plist, so an install killed
    // between the two leaves a rendered wrapper that names a program the agent
    // would have run, with no plist to say an agent was ever there.
    const w = syncWorld({ sync: syncJson() });
    expect(w.run(INSTALL, [GOOD_URL]).status).toBe(0);
    rmSync(w.syncPlist);
    const installed = w.calls().length;

    const result = w.run(UNINSTALL, []);

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(w.syncWrapper)).toBe(false);
    expect(result.stdout).toContain(
      `no ${SYNC_LABEL}.plist was there, so no agent was booted out`,
    );
    // The uninstall's own launchctl call is register-all's alone: there is no
    // plist that could have been loaded, and none is booted out to say so.
    expect(w.calls().slice(installed)).toEqual([`bootout gui/${UID}/${LABEL}`]);
  });
});

describe("the enrollment token's value", { timeout: 20_000 }, () => {
  it("appears in no output and in no file any of the three scripts wrote", () => {
    const w = world();
    const install = w.run(INSTALL, [GOOD_URL]);
    const run = spawnSync("/bin/sh", [w.wrapper], {
      encoding: "utf8",
      env: w.env(),
    });
    // Read before the uninstall, which is one of the files that goes away.
    const files = written(w);
    const uninstall = w.run(UNINSTALL, []);

    const output: readonly (readonly [string, string])[] = [
      ["install stdout", install.stdout],
      ["install stderr", install.stderr],
      ["wrapper stdout", run.stdout],
      ["wrapper stderr", run.stderr],
      ["uninstall stdout", uninstall.stdout],
      ["uninstall stderr", uninstall.stderr],
    ];
    // The token file itself is the one file that holds it, so it is not read
    // here: this asserts nothing else does.
    for (const [name, body] of [...output, ...files]) {
      expect(body, name).not.toContain(TOKEN_VALUE);
    }
    // The cases that must have run for that to mean anything.
    expect(install.status).toBe(0);
    expect(run.status).toBe(0);
    expect(uninstall.status).toBe(0);
    expect(files.map(([name]) => name).sort()).toEqual([
      "argv",
      "log",
      "plist",
      "record",
      "wrapper",
    ]);
  });
});

describe(
  "the sync agent's files and the enrollment token's value",
  { timeout: 20_000 },
  () => {
    it("hold neither the token's value nor the file it is in", () => {
      // The same case as above with the sync agent installed, which is a stronger
      // promise than the register-all agent's: that one is handed the token's
      // path, so only the value could be asserted, and this one must not name the
      // file either — waves sync reads each project's own token out of the
      // directory the plist names, after its collector has exited.
      const w = syncWorld({ sync: syncJson() });
      const install = w.run(INSTALL, [GOOD_URL]);
      const run = runOnTheLog(w);
      // Read before the uninstall, which is four of the files that go away.
      const files = written(w);
      // The config directory is named, because the client needs it, and the token
      // file inside it is not.
      const plist = text(w.syncPlist);
      const wrapper = text(w.syncWrapper);
      const uninstall = w.run(UNINSTALL, []);

      const output: readonly (readonly [string, string])[] = [
        ["install stdout", install.stdout],
        ["install stderr", install.stderr],
        ["uninstall stdout", uninstall.stdout],
        ["uninstall stderr", uninstall.stderr],
      ];
      for (const [name, body] of [...output, ...files]) {
        expect(body, name).not.toContain(TOKEN_VALUE);
      }
      expect(plist).toContain(dirname(w.syncConfig));
      expect(wrapper).not.toContain(w.token);

      // The cases that must have run for that to mean anything.
      expect(install.status, install.stderr).toBe(0);
      expect(run.status, text(w.syncLog)).toBe(0);
      expect(uninstall.status, uninstall.stderr).toBe(0);
      expect(files.map(([name]) => name).sort()).toEqual([
        "argv",
        "log",
        "plist",
        "record",
        "syncLog",
        "syncPlist",
        "syncWrapper",
        "wrapper",
      ]);
    });
  },
);

/**
 * `/usr/bin/plutil` on macOS, `xmllint` on a Linux that has one (CI's Ubuntu
 * runner does), and the case is skipped only where neither is there; a bad
 * plist is a job that never runs, which is the one mistake worth a lint.
 */
const LINTER: ((file: string) => SpawnSyncReturns<string>) | undefined =
  (() => {
    if (existsSync("/usr/bin/plutil")) {
      return (file) =>
        spawnSync("/usr/bin/plutil", ["-lint", file], { encoding: "utf8" });
    }
    if (
      spawnSync("sh", ["-c", "command -v xmllint"], {
        encoding: "utf8",
      }).stdout.trim() !== ""
    ) {
      return (file) =>
        spawnSync("xmllint", ["--noout", file], { encoding: "utf8" });
    }
    return undefined;
  })();

function lint(file: string): SpawnSyncReturns<string> {
  if (LINTER === undefined) {
    throw new Error("no plist linter on this machine");
  }
  return LINTER(file);
}

describe("the rendered plist", { timeout: 20_000 }, () => {
  it.skipIf(LINTER === undefined)("is XML a plist parser accepts", () => {
    const w = world();
    expect(w.run(INSTALL, ["https://waves.midnight.lan:8443/"]).status).toBe(0);

    const result = lint(w.plist);

    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  });

  it.skipIf(LINTER === undefined)(
    "is XML a plist parser accepts, with the sync agent's environment in it",
    () => {
      // The PATH is the one thing about the sync plist that is not a fixed
      // string, and it is rendered into XML: a character needing an escape would
      // be a job launchd never loads, which is the one mistake worth a lint.
      const w = syncWorld({ sync: syncJson() });
      expect(w.run(INSTALL, [GOOD_URL]).status).toBe(0);

      const result = lint(w.syncPlist);

      expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
    },
  );
});
