import { execFileSync, spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
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
 * The launchd LaunchAgent, run on Linux with `/bin/sh` and two stubs standing
 * in for the two things the owner's Mac has: `launchctl`, which nothing in CI
 * may call, and a client, whose `register-all` is another lane's.
 *
 * Every case is the same good fixture with at most one thing changed, in a
 * fresh `HOME` with its own config directory, so a refusal is the refusal and
 * not the state a previous case left behind. `LAUNCHCTL` is a shell script that
 * records its arguments, which is how bootout-then-bootstrap is asserted at
 * all: no macOS and no launchd are needed to see the order.
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

const LABEL = "cloud.krakowski.waves.register-all";
const GOOD_URL = "https://waves.midnight.lan";

/** A fixture value, not a credential: 60 characters of the token character set. */
const TOKEN_VALUE =
  "waves-enrollment-token-value-4d1f9a6c2b8e0f35a7c4d9b1e6f20a83";

/** `process.getuid()` is optional in the types; `id -u` is the same number. */
const UID = execFileSync("id", ["-u"]).toString().trim();

/** A file the scripts or the stubs wrote, named for the assertion that reads it. */
type Written = "wrapper" | "plist" | "log" | "record" | "argv";

interface World {
  readonly root: string;
  readonly home: string;
  readonly token: string;
  readonly node: string;
  readonly client: string;
  readonly wrapper: string;
  readonly plist: string;
  readonly log: string;
  readonly files: Readonly<Record<Written, string>>;
  run(script: string, args: readonly string[]): SpawnSyncReturns<string>;
  env(overrides?: Readonly<Record<string, string>>): NodeJS.ProcessEnv;
  calls(): readonly string[];
  mode(path: string): string;
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

function world(options: { readonly homeName?: string } = {}): World {
  const root = mkdtempSync(join(tmpdir(), "waves-launchd-"));
  roots.push(root);
  const home = join(root, options.homeName ?? "home");
  const config = join(root, "config");
  const bin = join(root, "bin");
  for (const directory of [home, config, bin]) {
    mkdirSync(directory, { recursive: true });
  }

  const token = join(config, "enroll.token");
  writeFileSync(token, `${TOKEN_VALUE}\n`);
  chmodSync(token, 0o600);

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
  const files: Record<Written, string> = {
    wrapper,
    plist,
    log,
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
    files,
    env,
    run: (script, args) =>
      spawnSync("/bin/sh", [script, ...args], { encoding: "utf8", env: env() }),
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

/** Every refusal is exit 2, one word on stderr naming it, and nothing loaded. */
function refusal(w: World, args: readonly string[], word: string): void {
  const result = w.run(INSTALL, args);
  expect(result.status, result.stderr).toBe(2);
  expect(result.stderr).toContain(word);
  expect(existsSync(w.plist), "a refusal renders no plist").toBe(false);
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

  it("writes a URL's & into the plist as &amp;", () => {
    const w = world();
    const url = "https://waves.midnight.lan?a=1&b=2";
    const result = w.run(INSTALL, [url]);

    expect(result.status, result.stderr).toBe(0);
    // A raw `&` in a plist string is not XML, and launchd answers a plist it
    // cannot parse with a job that never runs and no line in the log.
    expect(text(w.plist)).toContain(
      "<string>https://waves.midnight.lan?a=1&amp;b=2</string>",
    );
    expect(text(w.plist)).toBe(
      render(PLIST_TEMPLATE, {
        "@URL@": url.replaceAll("&", "&amp;"),
        "@WRAPPER@": w.wrapper,
        "@LOG@": w.log,
      }),
    );
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
    expect(w.run(INSTALL, ["https://waves.midnight.lan?a=1&b=2"]).status).toBe(
      0,
    );

    const result = lint(w.plist);

    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  });
});
