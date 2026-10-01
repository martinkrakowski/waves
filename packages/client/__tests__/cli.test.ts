import { afterEach, describe, expect, it, vi } from "vitest";

const originalArgv = process.argv;
const originalEnv = { ...process.env };

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = undefined;
  for (const key of Object.keys(process.env)) {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, originalEnv);
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("../src/index.js");
});

interface Written {
  readonly log: string[];
  readonly error: string[];
}

function capture(): Written {
  const log: string[] = [];
  const error: string[] = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => {
    log.push(line);
  });
  vi.spyOn(console, "error").mockImplementation((line: string) => {
    error.push(line);
  });
  return { log, error };
}

async function invoke(args: readonly string[]): Promise<Written> {
  const written = capture();
  process.argv = ["/usr/bin/node", "/opt/waves/dist/cli.js", ...args];
  vi.resetModules();
  await import("../src/cli.js");
  await vi.waitFor(() => {
    expect(process.exitCode).toBeTypeOf("number");
  });
  return written;
}

describe("cli", () => {
  it("forwards argv, writes the usage to stderr and exits 2", async () => {
    const written = await invoke([]);

    expect(written.error[0]).toBe("waves: no command given");
    expect(written.log).toEqual([]);
    expect(process.exitCode).toBe(2);
  });

  it("prints the usage on stdout and exits 0 when asked", async () => {
    const written = await invoke(["help"]);

    expect(written.log).toHaveLength(1);
    expect(written.log[0]).toContain("waves register <id>");
    expect(written.error).toEqual([]);
    expect(process.exitCode).toBe(0);
  });

  it("explains a certificate authority it cannot read, and exits 2", async () => {
    process.env.WAVES_URL = "https://waves.example.com";
    process.env.WAVES_PROJECT = "waves-demo";
    process.env.WAVES_CA_FILE = "/nowhere/ca.pem";

    const written = await invoke([
      "push",
      "--wave",
      "wv5",
      "--file",
      "/nowhere/status.json",
    ]);

    expect(written.error).toEqual([
      "waves push: WAVES_CA_FILE /nowhere/ca.pem cannot be read",
    ]);
    expect(written.log).toEqual([]);
    expect(process.exitCode).toBe(2);
  });

  it("says nothing about a crash", async () => {
    // A bug in this package, standing in for every one of them: the message
    // could carry anything, so not even the name is printed.
    vi.doMock("../src/index.js", () => ({
      main: () => Promise.reject(new Error("boom")),
    }));

    const written = await invoke(["push", "--wave", "wv5", "--stdin"]);

    expect(written.error).toEqual(["waves: unexpected failure"]);
    expect(written.log).toEqual([]);
    expect(process.exitCode).toBe(1);
  });
});
