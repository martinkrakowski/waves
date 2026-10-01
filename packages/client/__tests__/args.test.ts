import { describe, expect, it } from "vitest";

import { parseArgv } from "../src/domain/args.js";

function errorOf(argv: readonly string[]): string {
  const parsed = parseArgv(argv);
  if (parsed.ok) {
    throw new Error(`expected a refusal for ${JSON.stringify(argv)}`);
  }
  return parsed.error;
}

function commandOf(argv: readonly string[]) {
  const parsed = parseArgv(argv);
  if (!parsed.ok) {
    throw new Error(`expected ${JSON.stringify(argv)} to parse`);
  }
  return parsed.command;
}

describe("parseArgv", () => {
  it("asks for a command when there is none", () => {
    expect(errorOf([])).toBe("no command given");
  });

  it("prints usage for help, as a word or as a flag", () => {
    expect(commandOf(["help"])).toEqual({ kind: "help" });
    expect(commandOf(["--help"])).toEqual({ kind: "help" });
    expect(commandOf(["-h"])).toEqual({ kind: "help" });
  });

  it("refuses a command it does not have", () => {
    expect(errorOf(["publish"])).toBe("unknown command publish");
  });
});

describe("register", () => {
  it("reads an id, a name and an admin token file", () => {
    expect(
      commandOf([
        "register",
        "waves-demo",
        "--name",
        "Waves Demo",
        "--admin-token-file",
        "/run/secrets/admin",
      ]),
    ).toEqual({
      kind: "register",
      id: "waves-demo",
      name: "Waves Demo",
      repo: undefined,
      rotate: false,
      adminToken: { kind: "file", path: "/run/secrets/admin" },
    });
  });

  it("reads a repo, a rotation and the admin token on stdin", () => {
    expect(
      commandOf([
        "register",
        "waves-demo",
        "--name",
        "Waves Demo",
        "--repo",
        "https://github.com/example/waves.git",
        "--rotate",
        "--admin-token-stdin",
      ]),
    ).toEqual({
      kind: "register",
      id: "waves-demo",
      name: "Waves Demo",
      repo: "https://github.com/example/waves.git",
      rotate: true,
      adminToken: { kind: "stdin" },
    });
  });

  it("refuses an option that belongs to another command", () => {
    expect(errorOf(["register", "waves-demo", "--wave", "wv5"])).toBe(
      "--wave is not a register option",
    );
    expect(errorOf(["push", "--wave", "wv5", "--stdin", "--rotate"])).toBe(
      "--rotate is not a push option",
    );
    expect(errorOf(["delete", "--wave", "wv5", "--stdin"])).toBe(
      "--stdin is not a delete option",
    );
  });

  it("wants exactly one project id", () => {
    expect(errorOf(["register", "--name", "n", "--admin-token-stdin"])).toBe(
      "register takes exactly one project id",
    );
    expect(
      errorOf(["register", "one", "two", "--name", "n", "--admin-token-stdin"]),
    ).toBe("register takes exactly one project id");
  });

  it("refuses an id the contract would not accept", () => {
    expect(
      errorOf(["register", "Waves Demo", "--name", "n", "--admin-token-stdin"]),
    ).toBe("Waves Demo is not a project id");
  });

  it("wants a name of one to two hundred characters", () => {
    const base = ["register", "waves-demo", "--admin-token-stdin"];
    expect(errorOf([...base])).toContain("--name");
    expect(errorOf([...base, "--name", "  "])).toContain("--name");
    expect(errorOf([...base, "--name", "x".repeat(201)])).toContain("--name");
    expect(commandOf([...base, "--name", "n"]).kind).toBe("register");
  });

  it("takes only an absolute https repo", () => {
    const base = [
      "register",
      "waves-demo",
      "--name",
      "n",
      "--admin-token-stdin",
    ];
    expect(errorOf([...base, "--repo", "http://example.com/x"])).toBe(
      "--repo must be an absolute https URL",
    );
    expect(errorOf([...base, "--repo", "example.com"])).toBe(
      "--repo must be an absolute https URL",
    );
    expect(errorOf([...base, "--repo", "https://user:pw@example.com/"])).toBe(
      "--repo must be an absolute https URL",
    );
  });

  it("takes the admin token from one place only", () => {
    expect(errorOf(["register", "waves-demo", "--name", "n"])).toBe(
      "give --admin-token-file or --admin-token-stdin",
    );
    expect(
      errorOf([
        "register",
        "waves-demo",
        "--name",
        "n",
        "--admin-token-stdin",
        "--admin-token-file",
        "/run/secrets/admin",
      ]),
    ).toBe("give only one of --admin-token-file and --admin-token-stdin");
  });
});

describe("push", () => {
  it("reads a wave and a file", () => {
    expect(
      commandOf(["push", "--wave", "wv5", "--file", "status.json"]),
    ).toEqual({
      kind: "push",
      wave: "wv5",
      source: { kind: "file", path: "status.json" },
      intervalSeconds: null,
      includeTails: false,
    });
  });

  it("reads a wave, stdin, an interval and the tails", () => {
    expect(
      commandOf([
        "push",
        "--wave",
        "wv-5_2",
        "--stdin",
        "--interval",
        "300",
        "--include-tails",
      ]),
    ).toEqual({
      kind: "push",
      wave: "wv-5_2",
      source: { kind: "stdin" },
      intervalSeconds: 300,
      includeTails: true,
    });
  });

  it("takes no positional arguments", () => {
    expect(errorOf(["push", "wv5", "--stdin"])).toBe(
      "push takes no positional arguments",
    );
  });

  it("wants a wave the contract would accept", () => {
    expect(errorOf(["push", "--stdin"])).toBe("--wave is required");
    expect(errorOf(["push", "--wave", "-wv5", "--stdin"])).toBe(
      "-wv5 is not a wave id",
    );
    expect(errorOf(["push", "--wave", "wv 5", "--stdin"])).toBe(
      "wv 5 is not a wave id",
    );
  });

  it("takes the input from one place only", () => {
    expect(errorOf(["push", "--wave", "wv5"])).toBe("give --file or --stdin");
    expect(
      errorOf(["push", "--wave", "wv5", "--stdin", "--file", "status.json"]),
    ).toBe("give only one of --file and --stdin");
  });

  it("takes an interval of one to three hundred seconds", () => {
    const base = ["push", "--wave", "wv5", "--stdin"];
    expect(errorOf([...base, "--interval", "0"])).toContain("--interval");
    expect(errorOf([...base, "--interval", "301"])).toContain("--interval");
    expect(errorOf([...base, "--interval", "1.5"])).toContain("--interval");
    expect(errorOf([...base, "--interval", "sixty"])).toContain("--interval");
    expect(commandOf([...base, "--interval", "1"]).kind).toBe("push");
  });
});

describe("delete", () => {
  it("reads a wave", () => {
    expect(commandOf(["delete", "--wave", "wv5"])).toEqual({
      kind: "delete",
      wave: "wv5",
    });
  });

  it("wants a wave and nothing else", () => {
    expect(errorOf(["delete"])).toBe("--wave is required");
    expect(errorOf(["delete", "--wave", "wv5", "extra"])).toBe(
      "delete takes no positional arguments",
    );
  });
});

describe("options", () => {
  it("wants a value after a flag that takes one", () => {
    expect(errorOf(["push", "--wave"])).toBe("--wave needs a value");
    expect(errorOf(["push", "--wave", "--stdin"])).toBe("--wave needs a value");
    expect(errorOf(["push", "--wave", "", "--stdin"])).toBe(
      "--wave needs a value",
    );
  });

  it("refuses the same flag twice", () => {
    expect(errorOf(["push", "--wave", "wv5", "--wave", "wv6", "--stdin"])).toBe(
      "--wave was given twice",
    );
    expect(errorOf(["push", "--wave", "wv5", "--stdin", "--stdin"])).toBe(
      "--stdin was given twice",
    );
  });

  it("refuses an option it has never heard of", () => {
    expect(errorOf(["push", "--wave", "wv5", "--stdin", "--quiet"])).toBe(
      "unknown option --quiet",
    );
  });
});
