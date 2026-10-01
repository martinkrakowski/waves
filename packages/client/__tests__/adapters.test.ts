import { mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
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
const originalGetuid = process.getuid;

afterEach(() => {
  Object.defineProperty(process, "stdin", {
    value: originalStdin,
    configurable: true,
  });
  Object.defineProperty(process, "getuid", {
    value: originalGetuid,
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
  it("reads the wall clock it was given", () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-02-03T04:05:06.789Z"));
    expect(systemClock().now()).toBe(Date.parse("2026-02-03T04:05:06.789Z"));
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

  it("refuses a secret that is a link, and says what it is", async () => {
    const temporary = await temporaryDirectory();
    const files = fileSystem();
    const path = join(temporary.path, "waves-demo.token");
    const link = join(temporary.path, "link.token");
    await writeFile(path, "t0ken", { mode: SECRET_MODE });
    await symlink(path, link);

    // The link is never followed, so the file behind it is never read.
    await expect(files.readSecret(link)).rejects.toThrow(
      `${link} is a symbolic link; the token file must be a regular file`,
    );
    await temporary.remove();
  });

  it("refuses a secret that is not a file, or not owned by this user", async () => {
    const temporary = await temporaryDirectory();
    const files = fileSystem();
    await expect(files.readSecret(temporary.path)).rejects.toThrow(
      `${temporary.path} is not a regular file`,
    );

    Object.defineProperty(process, "getuid", {
      value: () => 4242,
      configurable: true,
    });
    const path = join(temporary.path, "waves-demo.token");
    await writeFile(path, "t0ken", { mode: SECRET_MODE });
    await expect(files.readSecret(path)).rejects.toThrow(
      `belongs to uid ${statSync(path).uid}, not to you`,
    );
    await temporary.remove();
  });

  it("skips the owner check where there is no owner to compare", async () => {
    const temporary = await temporaryDirectory();
    const files = fileSystem();
    const path = join(temporary.path, "waves-demo.token");
    await writeFile(path, "t0ken", { mode: SECRET_MODE });

    Object.defineProperty(process, "getuid", {
      value: undefined,
      configurable: true,
    });
    expect((await files.readSecret(path))?.text).toBe("t0ken");
    await temporary.remove();
  });

  it("refuses a secret anyone else can reach, and says which mode it is", async () => {
    const temporary = await temporaryDirectory();
    const files = fileSystem();
    const path = join(temporary.path, "waves-demo.token");
    await writeFile(path, "t0ken", { mode: 0o644 });

    await expect(files.readSecret(path)).rejects.toThrow(
      `is mode 0o644; it must be 0600 or stricter`,
    );
    await temporary.remove();
  });

  it("names the path and the code of anything the kernel refused", async () => {
    const temporary = await temporaryDirectory();
    const files = fileSystem();
    await expect(files.readText(temporary.path)).rejects.toThrow(
      `${temporary.path} could not be read: EISDIR`,
    );
    await expect(files.exists(temporary.path)).resolves.toBe(true);
    await expect(files.readText(TOO_LONG)).rejects.toThrow(
      `${TOO_LONG} could not be read: ENAMETOOLONG`,
    );
    await expect(files.readSecret(TOO_LONG)).rejects.toThrow(
      `${TOO_LONG} could not be read: ENAMETOOLONG`,
    );
    await expect(files.exists(TOO_LONG)).rejects.toThrow(
      `${TOO_LONG} could not be read: ENAMETOOLONG`,
    );
    await temporary.remove();
  });

  it("writes a secret 0600 into a directory 0700", async () => {
    const temporary = await temporaryDirectory();
    const files = fileSystem();
    const path = join(temporary.path, "config", "waves-demo.token");

    await files.writeSecret(path, "t0ken");

    expect(statSync(path).mode & 0o777).toBe(SECRET_MODE);
    expect(statSync(join(temporary.path, "config")).mode & 0o777).toBe(
      DIRECTORY_MODE,
    );
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
    expect(statSync(path).mode & 0o777).toBe(SECRET_MODE);
    expect(await readdir(temporary.path)).toEqual(["waves-demo.token"]);
    await temporary.remove();
  });

  it("takes the temporary file away with it when a save fails", async () => {
    const temporary = await temporaryDirectory();
    const files = fileSystem();
    const directory = join(temporary.path, "config");
    // The destination is already a directory, so the rename cannot replace it.
    await mkdir(join(directory, "waves-demo.token"), {
      recursive: true,
      mode: DIRECTORY_MODE,
    });

    await expect(
      files.writeSecret(join(directory, "waves-demo.token"), "t0ken"),
    ).rejects.toThrow();
    // Nothing of the secret is left in the directory behind it.
    expect(await readdir(directory)).toEqual(["waves-demo.token"]);
    await temporary.remove();
  });

  it("refuses a config directory someone else can reach, and says what to run", async () => {
    const temporary = await temporaryDirectory();
    const files = fileSystem();
    const directory = join(temporary.path, "config");
    await mkdir(directory, { mode: 0o750 });

    await expect(
      files.writeSecret(join(directory, "waves-demo.token"), "t0ken"),
    ).rejects.toThrow(
      `${directory} is mode 0o750; run chmod 700 ${directory} so only you can reach the tokens in it`,
    );
    expect(statSync(directory).mode & 0o777).toBe(0o750);
    await temporary.remove();
  });

  it("refuses a config directory that is a link, and leaves it alone", async () => {
    const temporary = await temporaryDirectory();
    const files = fileSystem();
    const real = join(temporary.path, "real");
    const link = join(temporary.path, "config");
    await mkdir(real, { mode: 0o700 });
    await symlink(real, link);

    await expect(
      files.writeSecret(join(link, "waves-demo.token"), "t0ken"),
    ).rejects.toThrow(
      `${link} is a symbolic link; point WAVES_CONFIG_DIR at the directory itself`,
    );
    expect(await readdir(real)).toEqual([]);
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

  it("leaves a config directory it did not create alone", async () => {
    const temporary = await temporaryDirectory();
    const files = fileSystem();
    const directory = join(temporary.path, "config");
    await mkdir(directory, { mode: 0o700 });

    await files.writeSecret(join(directory, "waves-demo.token"), "t0ken");
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    await temporary.remove();
  });

  it("checks a config directory without creating one", async () => {
    const temporary = await temporaryDirectory();
    const files = fileSystem();
    const absent = join(temporary.path, "not-there");

    // Nothing to check where this client will create the directory itself.
    await expect(files.checkSecretDirectory(absent)).resolves.toBeUndefined();
    await expect(readdir(temporary.path)).resolves.toEqual([]);

    const directory = join(temporary.path, "config");
    await mkdir(directory, { mode: 0o700 });
    await expect(
      files.checkSecretDirectory(directory),
    ).resolves.toBeUndefined();
    await temporary.remove();
  });

  it("refuses a config directory of somebody else's, and does not create it", async () => {
    const temporary = await temporaryDirectory();
    const files = fileSystem();
    const directory = join(temporary.path, "config");
    await mkdir(directory, { mode: 0o700 });

    Object.defineProperty(process, "getuid", {
      value: () => 4242,
      configurable: true,
    });
    await expect(files.checkSecretDirectory(directory)).rejects.toThrow(
      `${directory} belongs to uid ${statSync(directory).uid}, not to you`,
    );
    await expect(
      files.writeSecret(join(directory, "waves-demo.token"), "t0ken"),
    ).rejects.toThrow("not to you");
    await expect(readdir(directory)).resolves.toEqual([]);
    await temporary.remove();
  });

  it("refuses a config directory that is a plain file", async () => {
    const temporary = await temporaryDirectory();
    const files = fileSystem();
    const blocker = join(temporary.path, "config");
    await writeFile(blocker, "not a directory");

    await expect(files.checkSecretDirectory(blocker)).rejects.toThrow(
      `${blocker} is not a directory`,
    );
    await temporary.remove();
  });

  it("names the path and the code of a config directory it cannot even look at", async () => {
    const temporary = await temporaryDirectory();
    const files = fileSystem();
    await expect(files.checkSecretDirectory(TOO_LONG)).rejects.toThrow(
      `${TOO_LONG} could not be read: ENAMETOOLONG`,
    );
    await temporary.remove();
  });
});
