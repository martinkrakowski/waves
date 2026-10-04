import { realpath, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { RunOutcome } from "../src/application/ports.js";
import {
  DRAIN_CAP_MS,
  MAX_STDERR_BYTES,
  MAX_STDOUT_BYTES,
  processRunner,
} from "../src/infrastructure/runner.js";
import { temporaryDirectory } from "./support/harness.js";

/**
 * The adapter is tested against real programs rather than a fake `spawn`, because
 * everything it does is about what the operating system does to a process: a
 * group, a signal, a pipe somebody else is holding. A fake would only prove the
 * fake's own shape.
 */

let cwd: string;
let remove: () => Promise<void>;

beforeAll(async () => {
  const temporary = await temporaryDirectory();
  // The real path: on macOS `/var` is a link to `/private/var`, and a child
  // reports the directory it runs in by its real path.
  cwd = await realpath(temporary.path);
  remove = temporary.remove;
});

afterAll(async () => {
  await remove();
});

const NODE = process.execPath;

function run(
  script: string,
  overrides: Partial<{
    readonly command: readonly string[];
    readonly timeoutMs: number;
    readonly maxStdout: number;
    readonly maxStderr: number;
    readonly env: Record<string, string>;
    readonly cwd: string;
  }> = {},
): Promise<RunOutcome> {
  return processRunner().run({
    command: overrides.command ?? [NODE, "-e", script],
    cwd: overrides.cwd ?? cwd,
    env: overrides.env ?? { PATH: "/usr/bin" },
    timeoutMs: overrides.timeoutMs ?? 5000,
    ...(overrides.maxStdout === undefined
      ? {}
      : { maxStdout: overrides.maxStdout }),
    ...(overrides.maxStderr === undefined
      ? {}
      : { maxStderr: overrides.maxStderr }),
  });
}

describe("a program that answers", () => {
  it("is read whole, with its exit code and its stderr", async () => {
    const outcome = await run(
      'process.stdout.write(JSON.stringify({waves:[]}));console.error("a note");process.exit(0);',
    );

    expect(outcome).toEqual({
      kind: "exit",
      code: 0,
      stdout: '{"waves":[]}',
      stderr: "a note\n",
      stderrTruncated: false,
    });
  });

  it("keeps a non-zero exit as an exit, with its code", async () => {
    const outcome = await run(
      'process.stdout.write("partial");process.exit(3);',
    );

    expect(outcome).toMatchObject({ kind: "exit", code: 3, stdout: "partial" });
  });

  it("has no code at all when a signal killed it", async () => {
    const outcome = await run('process.kill(process.pid,"SIGKILL");');

    expect(outcome).toMatchObject({ kind: "exit", code: null });
  });

  it("runs in the directory it was given, with the environment it was given", async () => {
    const outcome = await run(
      "process.stdout.write(`${process.cwd()}|${process.env.WAVES_PROJECT}|${process.env.WAVES_URL}`);",
      {
        env: { PATH: "/usr/bin", WAVES_PROJECT: "waves-demo" },
      },
    );

    expect(outcome).toMatchObject({
      kind: "exit",
      stdout: `${cwd}|waves-demo|undefined`,
    });
  });
});

describe("a program that will not stop", () => {
  it("is a timeout, and the group is killed", async () => {
    const started = Date.now();
    const outcome = await run("setTimeout(()=>{},10000);", { timeoutMs: 200 });

    expect(outcome).toEqual({ kind: "timeout" });
    // A timeout that waited for the program rather than killing it would take ten
    // seconds here, so the cap is part of what this asserts.
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("is a timeout even when the kill never lands and exit never comes", async () => {
    // A signal the kernel will not deliver — EPERM, or a process in
    // uninterruptible I/O — means no `exit` event, and a scheduled run that waits
    // for one never fires again. The kill here does nothing at all, which is what
    // makes that the only honest way to see the cap.
    const pidFile = join(cwd, "unkillable.pid");
    const sleeper = [
      `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
      "setTimeout(()=>{},30000);",
    ].join("");
    const started = Date.now();
    const outcome = await processRunner({ kill: () => undefined }).run({
      command: [NODE, "-e", sleeper],
      cwd,
      env: { PATH: "/usr/bin" },
      timeoutMs: 200,
    });

    expect(outcome).toEqual({ kind: "timeout" });
    expect(Date.now() - started).toBeLessThan(DRAIN_CAP_MS + 4000);

    // The program really is still running, which is the whole point: nothing this
    // client can do about it, and its pipe and its process handle are both let go.
    const pid = Number(await readFile(pidFile, "utf8"));
    expect(isAlive(pid)).toBe(true);
    process.kill(pid, "SIGKILL");
  }, 20_000);

  it("is an overflow once its stdout is past the cap, not a timeout", async () => {
    const outcome = await run(
      'process.stdout.write("x".repeat(5000));setTimeout(()=>{},10000);',
      { maxStdout: 1000, timeoutMs: 10000 },
    );

    expect(outcome).toEqual({ kind: "overflow" });
  });

  it("keeps a stderr past its cap as a cut note rather than a failure", async () => {
    const outcome = await run(
      `process.stderr.write("y".repeat(${MAX_STDERR_BYTES + 1000}));process.stdout.write("done");`,
    );

    expect(outcome).toMatchObject({
      kind: "exit",
      code: 0,
      stdout: "done",
      stderrTruncated: true,
    });
    expect(outcome.kind === "exit" && outcome.stderr.length).toBe(
      MAX_STDERR_BYTES,
    );
  });

  it("does not stop a collector that keeps writing stderr", async () => {
    // The cap is on what is kept, not on what is read: a pipe nobody drains fills
    // up, and a collector blocked on a write is one the timeout would blame.
    const outcome = await run(
      `const left=setInterval(()=>process.stderr.write("y".repeat(1024)),5);setTimeout(()=>{clearInterval(left);process.stdout.write("finished");},400);`,
      { maxStderr: 16 },
    );

    expect(outcome).toMatchObject({
      kind: "exit",
      code: 0,
      stdout: "finished",
      stderrTruncated: true,
    });
  });

  it("caps stdout at four megabytes by default", async () => {
    expect(MAX_STDOUT_BYTES).toBe(4 * 1024 * 1024);
    const outcome = await run("process.stdout.write('a'.repeat(100000));");
    expect(outcome).toMatchObject({ kind: "exit", stdout: "a".repeat(100000) });
  });
});

describe("a grandchild that outlives its parent", () => {
  /**
   * The child leaves a grandchild holding the pipe it was given, prints that
   * grandchild's pid and exits at once — `process.exit`, because a Node child
   * that merely falls off the end of its script waits for its own grandchild, and
   * the pipes would close with it. Nothing about the child's own exit says
   * anything about the pipe, so this is the case the group kill exists for.
   */
  const holder = [
    "const {spawn}=require('node:child_process');",
    "const g=spawn(process.execPath,['-e','setTimeout(()=>{},5000)'],",
    "{stdio:['ignore',1,2]",
  ].join("");
  const announce = (extra: string): string =>
    `${holder}${extra}});` +
    "require('node:fs').writeSync(1,String(g.pid));process.exit(0);";

  it("is killed with the group, so the pipe closes and the run finishes", async () => {
    const started = Date.now();
    const outcome = await run(announce(""));

    expect(outcome).toMatchObject({ kind: "exit", code: 0, stderr: "" });
    // Five seconds is how long the grandchild would have held the pipe, so a run
    // that waited for it rather than killing it would show up here.
    expect(Date.now() - started).toBeLessThan(4000);

    const gpid = Number(outcome.kind === "exit" ? outcome.stdout : "");
    expect(gpid).toBeGreaterThan(0);
    await expectGone(gpid);
  }, 15_000);

  it("never keeps the run waiting for longer than the drain cap", async () => {
    // This grandchild puts itself in a group of its own, so the kill of the
    // child's group does not reach it: the pipe stays open, and the cap is the
    // only thing that ends the wait.
    const started = Date.now();
    const outcome = await run(announce(",detached:true"));

    expect(outcome).toMatchObject({ kind: "exit", code: 0, stderr: "" });
    expect(Date.now() - started).toBeLessThan(DRAIN_CAP_MS + 2000);

    const gpid = Number(outcome.kind === "exit" ? outcome.stdout : "");
    expect(isAlive(gpid)).toBe(true);
    process.kill(gpid, "SIGKILL");
  }, 15_000);
});

describe("a program that could not be run at all", () => {
  it("is a spawn error, with the kernel's own message", async () => {
    const outcome = await run("", {
      command: ["/nonexistent/waves-collector"],
    });

    expect(outcome.kind).toBe("spawn-error");
    expect(outcome.kind === "spawn-error" && outcome.message).toContain(
      "ENOENT",
    );
  });

  it("is a spawn error when there is no program to run", async () => {
    expect(await run("", { command: [] })).toEqual({
      kind: "spawn-error",
      message: "no program to run",
    });
    expect(await run("", { command: [""] })).toEqual({
      kind: "spawn-error",
      message: "no program to run",
    });
  });

  it("is a spawn error when the directory is not there", async () => {
    const outcome = await run("", { cwd: "/nonexistent/waves" });

    expect(outcome.kind).toBe("spawn-error");
  });

  it("is a spawn error when the directory is a file, which Node throws at", async () => {
    // Every other refusal of a spawn arrives as an `error` event; a `cwd` naming a
    // file is thrown before there is a handle to listen with, so it has to be
    // caught here or it escapes as a crash and takes the whole run with it.
    const blocker = join(cwd, "not-a-directory");
    await writeFile(blocker, "not a directory");

    const outcome = await run("", { cwd: blocker });

    expect(outcome.kind).toBe("spawn-error");
    expect(outcome.kind === "spawn-error" && outcome.message).toContain(
      "ENOTDIR",
    );
  });
});

/**
 * Waits a moment for a process this run should have killed. A reaped process is
 * gone from the table; one that is still dying answers for a while, and how long
 * is the machine's business rather than this client's.
 */
async function expectGone(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (!isAlive(pid)) {
      return;
    }
    await new Promise((done) => setTimeout(done, 20));
  }
  expect(isAlive(pid)).toBe(false);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
