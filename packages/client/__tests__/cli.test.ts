import { afterEach, describe, expect, it, vi } from "vitest";

const originalArgv = process.argv;

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = undefined;
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("cli", () => {
  it("forwards argv to the entrypoint, writes to stderr and exits 2", async () => {
    const written: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: string) => {
      written.push(line);
    });
    process.argv = ["/usr/bin/node", "/opt/waves/dist/cli.js", "publish"];

    vi.resetModules();
    await import("../src/cli.js");

    expect(written).toEqual(["waves publish: not implemented yet"]);
    expect(process.exitCode).toBe(2);
  });

  it("reports the bare command name when no command is given", async () => {
    const written: string[] = [];
    vi.spyOn(console, "error").mockImplementation((line: string) => {
      written.push(line);
    });
    process.argv = ["/usr/bin/node", "/opt/waves/dist/cli.js"];

    vi.resetModules();
    await import("../src/cli.js");

    expect(written).toEqual(["waves: not implemented yet"]);
    expect(process.exitCode).toBe(2);
  });
});
