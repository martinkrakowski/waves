import { mkdir, readFile, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import { environment } from "../src/infrastructure/env.js";
import {
  DIRECTORY_MODE,
  SECRET_MODE,
  fileSystem,
} from "../src/infrastructure/fs.js";
import { readStream, standardInput } from "../src/infrastructure/stdin.js";
import { systemClock, systemSleeper } from "../src/infrastructure/timers.js";
import { temporaryDirectory } from "./support/harness.js";

const originalStdin = process.stdin;

afterEach(() => {
  Object.defineProperty(process, "stdin", {
    value: originalStdin,
    configurable: true,
  });
  vi.useRealTimers();
});

/** A single path component long enough that `stat` refuses it outright. */
const TOO_LONG = `/${"x".repeat(5000)}`;

describe("environment", () => {
  it("reads a source it was given, and the home directory of the user", () => {
    const port = environment({ WAVES_URL: "https://waves.example.com" });
    expect(port.get("WAVES_URL")).toBe("https://waves.example.com");
    expect(port.get("WAVES_PROJECT")).toBeUndefined();
    expect(port.home()).toBe(homedir());
  });

  it("reads the real environment when it is given none", () => {
    expect(environment().get("PATH")).toBe(process.env["PATH"]);
  });
});

describe("the clock and the sleeper", () => {
  it("reads the wall clock", () => {
    expect(Math.abs(systemClock().now() - Date.now())).toBeLessThan(1000);
  });

  it("waits exactly as long as it was asked to", async () => {
    vi.useFakeTimers();
    let settled = false;
    const pending = systemSleeper()
      .sleep(1000)
      .then(() => {
        settled = true;
      });
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBe(true);
  });
});

describe("standard input", () => {
  it("reads strings and buffers alike", async () => {
    expect(await readStream(Readable.from(["ab", "cd"]))).toBe("abcd");
    expect(await readStream(Readable.from([Buffer.from("ef")]))).toBe("ef");
    expect(await readStream(Readable.from([]))).toBe("");
  });

  it("reads the process's own standard input", async () => {
    Object.defineProperty(process, "stdin", {
      value: Readable.from(["on stdin"]),
      configurable: true,
    });
    expect(await standardInput().read()).toBe("on stdin");
  });
});

describe("the filesystem", () => {
  it("reads a file, and reports one that is not there", async () => {
    const temporary = await temporaryDirectory();
    const files = fileSystem();
    await writeFile(join(temporary.path, "status.json"), '{"lanes":[]}');
    expect(await files.readText(join(temporary.path, "status.json"))).toBe(
      '{"lanes":[]}',
    );
    expect(
      await files.readText(join(temporary.path, "missing.json")),
    ).toBeUndefined();
    expect(await files.exists(join(temporary.path, "status.json"))).toBe(true);
    expect(await files.exists(join(temporary.path, "missing.json"))).toBe(
      false,
    );
    await temporary.remove();
  });

  it("reads a secret with the mode it was written with", async () => {
    const temporary = await temporaryDirectory();
    const files = fileSystem();
    const path = join(temporary.path, "waves-demo.token");
    await writeFile(path, "t0ken", { mode: SECRET_MODE });
    const read = await files.readSecret(path);
    expect(read?.text).toBe("t0ken");
    expect(read?.mode).toBeTypeOf("number");
    expect((read?.mode ?? 0) & 0o777).toBe(SECRET_MODE);
    expect(
      await files.readSecret(join(temporary.path, "missing.token")),
    ).toBeUndefined();
    await temporary.remove();
  });

  it("passes on a failure that is not a missing file", async () => {
    const temporary = await temporaryDirectory();
    const files = fileSystem();
    await expect(files.readText(temporary.path)).rejects.toThrow();
    await expect(files.readSecret(temporary.path)).rejects.toThrow();
    await expect(files.exists(temporary.path)).resolves.toBe(true);
    await expect(files.readText(TOO_LONG)).rejects.toThrow();
    await expect(files.readSecret(TOO_LONG)).rejects.toThrow();
    await expect(files.exists(TOO_LONG)).rejects.toThrow();
    await temporary.remove();
  });

  it("writes a secret 0600 into a directory 0700", async () => {
    const temporary = await temporaryDirectory();
    const files = fileSystem();
    const path = join(temporary.path, "config", "waves-demo.token");

    await files.writeSecret(path, "t0ken");

    expect(statSyncMode(path)).toBe(SECRET_MODE);
    expect(statSyncMode(join(temporary.path, "config"))).toBe(DIRECTORY_MODE);
    expect(await readFile(path, "utf8")).toBe("t0ken");
    await temporary.remove();
  });

  it("replaces a secret in one step, leaving no loose copy behind", async () => {
    const temporary = await temporaryDirectory();
    const files = fileSystem();
    const path = join(temporary.path, "waves-demo.token");

    await files.writeSecret(path, "first");
    await files.writeSecret(path, "second");

    expect(await readFile(path, "utf8")).toBe("second");
    expect(statSyncMode(path)).toBe(SECRET_MODE);
    await expect(readFile(path, "utf8")).resolves.toBe("second");
    await temporary.remove();
  });

  it("leaves a directory it did not create alone", async () => {
    const temporary = await temporaryDirectory();
    const files = fileSystem();
    const directory = join(temporary.path, "config");
    await mkdir(directory, { mode: 0o755 });

    await files.writeSecret(join(directory, "waves-demo.token"), "t0ken");
    expect(statSyncMode(directory)).toBe(0o755);

    await files.writeSecret(join(temporary.path, "other", "a.token"), "t0ken");
    expect(statSyncMode(join(temporary.path, "other"))).toBe(DIRECTORY_MODE);
    await temporary.remove();
  });

  it("refuses to write where the parent is a file", async () => {
    const temporary = await temporaryDirectory();
    const files = fileSystem();
    const blocker = join(temporary.path, "blocker");
    await writeFile(blocker, "not a directory");

    await expect(
      files.writeSecret(join(blocker, "waves-demo.token"), "t0ken"),
    ).rejects.toThrow();
    await expect(
      files.writeSecret(`${TOO_LONG}/waves-demo.token`, "t0ken"),
    ).rejects.toThrow();
    await temporary.remove();
  });
});

function statSyncMode(path: string): number {
  return statSync(path).mode & 0o777;
}
