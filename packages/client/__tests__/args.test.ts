import { describe, expect, it } from "vitest";

import { USAGE, parseArgv } from "../src/domain/args.js";

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

  it("names every command it has in the usage, sync included", () => {
    for (const command of [
      "register",
      "register-all",
      "push",
      "status",
      "sync",
      "decision",
    ]) {
      expect(USAGE).toContain(`waves ${command}`);
    }
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
      credential: {
        role: "admin",
        source: { kind: "file", path: "/run/secrets/admin" },
      },
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
      credential: { role: "admin", source: { kind: "stdin" } },
    });
  });

  it("takes an enrollment token as well, which is a third way in", () => {
    expect(
      commandOf([
        "register",
        "client-portal",
        "--name",
        "Client Portal",
        "--enrollment-token-file",
        "/run/secrets/enroll",
      ]),
    ).toEqual({
      kind: "register",
      id: "client-portal",
      name: "Client Portal",
      repo: undefined,
      rotate: false,
      credential: {
        role: "enrollment",
        source: { kind: "file", path: "/run/secrets/enroll" },
      },
    });
    expect(
      commandOf([
        "register",
        "client-portal",
        "--name",
        "Client Portal",
        "--enrollment-token-stdin",
      ]),
    ).toMatchObject({
      credential: { role: "enrollment", source: { kind: "stdin" } },
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

  it("takes a name the contract would store, and names the flag it will not", () => {
    const base = ["register", "waves-demo", "--admin-token-stdin"];
    expect(errorOf([...base])).toBe("--name: expected at least 1 characters");
    expect(errorOf([...base, "--name", "  "])).toBe(
      "--name: expected at least 1 characters",
    );
    expect(errorOf([...base, "--name", "x".repeat(81)])).toBe(
      "--name: expected at most 80 characters",
    );
    expect(
      errorOf([...base, "--name", `two${String.fromCharCode(7)}lines`]),
    ).toBe("--name: expected printable text");
    expect(commandOf([...base, "--name", "n"]).kind).toBe("register");
    expect(commandOf([...base, "--name", "x".repeat(80)]).kind).toBe(
      "register",
    );
  });

  it("takes only an absolute https repo of at most 200 characters", () => {
    const base = [
      "register",
      "waves-demo",
      "--name",
      "n",
      "--admin-token-stdin",
    ];
    expect(errorOf([...base, "--repo", "http://example.com/x"])).toBe(
      "--repo: expected an https URL",
    );
    expect(errorOf([...base, "--repo", "example.com"])).toBe(
      "--repo: expected an https URL",
    );
    expect(errorOf([...base, "--repo", "https://user:pw@example.com/"])).toBe(
      "--repo: expected no user or password in the URL",
    );
    expect(
      errorOf([...base, "--repo", `https://example.com/${"x".repeat(200)}`]),
    ).toBe("--repo: expected at most 200 characters");
    expect(
      commandOf([...base, "--repo", "https://github.com/example/waves.git"])
        .kind,
    ).toBe("register");
  });

  it("takes a credential from exactly one of the four flags", () => {
    const base = ["register", "waves-demo", "--name", "n"];
    expect(errorOf([...base])).toBe(
      "give --admin-token-file, --admin-token-stdin, --enrollment-token-file or --enrollment-token-stdin",
    );
    expect(
      errorOf([
        ...base,
        "--admin-token-stdin",
        "--admin-token-file",
        "/run/secrets/admin",
      ]),
    ).toBe(
      "give only one of --admin-token-file, --admin-token-stdin, --enrollment-token-file and --enrollment-token-stdin",
    );
    expect(
      errorOf([
        ...base,
        "--admin-token-file",
        "/run/secrets/admin",
        "--enrollment-token-file",
        "/run/secrets/enroll",
      ]),
    ).toBe(
      "give only one of --admin-token-file, --admin-token-stdin, --enrollment-token-file and --enrollment-token-stdin",
    );
    expect(
      errorOf([...base, "--admin-token-stdin", "--enrollment-token-stdin"]),
    ).toBe(
      "give only one of --admin-token-file, --admin-token-stdin, --enrollment-token-file and --enrollment-token-stdin",
    );
  });

  it("will not rotate with an enrollment token, before anything is sent", () => {
    const message =
      "--rotate needs the admin token; an enrollment token can only register a new project";
    expect(
      errorOf([
        "register",
        "waves-demo",
        "--name",
        "n",
        "--rotate",
        "--enrollment-token-file",
        "/run/secrets/enroll",
      ]),
    ).toBe(message);
    expect(
      errorOf([
        "register",
        "waves-demo",
        "--name",
        "n",
        "--rotate",
        "--enrollment-token-stdin",
      ]),
    ).toBe(message);
    // The admin token is the one that can replace a token, so this is not one.
    expect(
      commandOf([
        "register",
        "waves-demo",
        "--name",
        "n",
        "--rotate",
        "--admin-token-stdin",
      ]).kind,
    ).toBe("register");
  });
});

describe("register-all", () => {
  it("reads an enrollment token, a list and the verbosity", () => {
    expect(
      commandOf([
        "register-all",
        "--enrollment-token-file",
        "/run/secrets/enroll",
        "--projects",
        "/elsewhere/list.json",
        "--verbose",
      ]),
    ).toEqual({
      kind: "register-all",
      credential: {
        role: "enrollment",
        source: { kind: "file", path: "/run/secrets/enroll" },
      },
      projects: "/elsewhere/list.json",
      verbose: true,
    });
    expect(commandOf(["register-all", "--enrollment-token-stdin"])).toEqual({
      kind: "register-all",
      credential: { role: "enrollment", source: { kind: "stdin" } },
      projects: undefined,
      verbose: false,
    });
  });

  it("takes an enrollment token from one place only", () => {
    expect(errorOf(["register-all"])).toBe(
      "give --enrollment-token-file or --enrollment-token-stdin",
    );
    expect(
      errorOf([
        "register-all",
        "--enrollment-token-stdin",
        "--enrollment-token-file",
        "/run/secrets/enroll",
      ]),
    ).toBe(
      "give only one of --enrollment-token-file and --enrollment-token-stdin",
    );
  });

  it("takes no admin token, no rotation and no project id", () => {
    expect(
      errorOf(["register-all", "--admin-token-file", "/run/secrets/admin"]),
    ).toBe("--admin-token-file is not a register-all option");
    expect(errorOf(["register-all", "--admin-token-stdin"])).toBe(
      "--admin-token-stdin is not a register-all option",
    );
    expect(
      errorOf(["register-all", "--enrollment-token-stdin", "--rotate"]),
    ).toBe("--rotate is not a register-all option");
    expect(
      errorOf(["register-all", "waves-demo", "--enrollment-token-stdin"]),
    ).toBe("register-all takes no positional arguments");
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

describe("status", () => {
  it("reads a file and an interval", () => {
    expect(
      commandOf(["status", "--file", "backlog.json", "--interval", "30"]),
    ).toEqual({
      kind: "status",
      source: { kind: "file", path: "backlog.json" },
      intervalSeconds: 30,
    });
  });

  it("reads stdin, and no interval at all", () => {
    expect(commandOf(["status", "--stdin"])).toEqual({
      kind: "status",
      source: { kind: "stdin" },
      intervalSeconds: null,
    });
  });

  it("takes no positional arguments and no flag of another command", () => {
    expect(errorOf(["status", "backlog", "--stdin"])).toBe(
      "status takes no positional arguments",
    );
    expect(errorOf(["status", "--stdin", "--include-tails"])).toBe(
      "--include-tails is not a status option",
    );
    expect(errorOf(["status", "--stdin", "--wave", "wv5"])).toBe(
      "--wave is not a status option",
    );
  });

  it("takes the input from one place only", () => {
    expect(errorOf(["status"])).toBe("give --file or --stdin");
    expect(errorOf(["status", "--stdin", "--file", "backlog.json"])).toBe(
      "give only one of --file and --stdin",
    );
  });

  it("takes an interval of one to three hundred seconds", () => {
    const base = ["status", "--stdin"];
    expect(errorOf([...base, "--interval", "0"])).toBe(
      "--interval must be a whole number of seconds between 1 and 300",
    );
    expect(errorOf([...base, "--interval", "301"])).toBe(
      "--interval must be a whole number of seconds between 1 and 300",
    );
    expect(errorOf([...base, "--interval", "1.5"])).toBe(
      "--interval must be a whole number of seconds between 1 and 300",
    );
    expect(commandOf([...base, "--interval", "300"])).toEqual({
      kind: "status",
      source: { kind: "stdin" },
      intervalSeconds: 300,
    });
  });

  it("refuses an option it has never heard of", () => {
    expect(errorOf(["status", "--stdin", "--quiet"])).toBe(
      "unknown option --quiet",
    );
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

describe("sync", () => {
  it("takes no arguments at all", () => {
    expect(commandOf(["sync"])).toEqual({ kind: "sync", check: false });
    expect(errorOf(["sync", "extra"])).toBe(
      "sync takes no positional arguments",
    );
  });

  it("takes --check, which asks about the file rather than changing it", () => {
    expect(commandOf(["sync", "--check"])).toEqual({
      kind: "sync",
      check: true,
    });
    expect(USAGE).toContain("waves sync [--check]");
  });

  it("refuses every other flag, because the file is the configuration", () => {
    expect(errorOf(["sync", "--interval", "60"])).toBe(
      "--interval is not a sync option",
    );
    expect(errorOf(["sync", "--file", "/tmp/sync.json"])).toBe(
      "--file is not a sync option",
    );
    expect(errorOf(["sync", "--verbose"])).toBe(
      "--verbose is not a sync option",
    );
    // --check belongs to sync alone: nowhere else could it mean anything.
    expect(
      errorOf(["push", "--check", "--wave", "wv5", "--file", "/tmp/x"]),
    ).toBe("--check is not a push option");
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

describe("decision", () => {
  const SHA = "a".repeat(64);

  it("reads a raise from a file or from stdin", () => {
    expect(commandOf(["decision", "raise", "--file", "decision.json"])).toEqual(
      {
        kind: "decision",
        action: "raise",
        source: { kind: "file", path: "decision.json" },
      },
    );
    expect(commandOf(["decision", "raise", "--stdin"])).toEqual({
      kind: "decision",
      action: "raise",
      source: { kind: "stdin" },
    });
    // --file - is stdin, the same as --stdin.
    expect(commandOf(["decision", "raise", "--file", "-"])).toEqual({
      kind: "decision",
      action: "raise",
      source: { kind: "stdin" },
    });
  });

  it("reads a decision id for read", () => {
    expect(commandOf(["decision", "read", "d1"])).toEqual({
      kind: "decision",
      action: "read",
      id: "d1",
    });
  });

  it("reads a report with its required flags", () => {
    expect(
      commandOf([
        "decision",
        "report",
        "d1",
        "--state",
        "approved",
        "--words",
        "go with B",
        "--revision",
        "1",
        "--text-sha256",
        SHA,
        "--entries",
        "0",
      ]),
    ).toEqual({
      kind: "decision",
      action: "report",
      id: "d1",
      state: "approved",
      words: "go with B",
      revision: 1,
      textSha256: SHA,
      entries: 0,
    });
  });

  it("reads the optional flags of a report", () => {
    expect(
      commandOf([
        "decision",
        "report",
        "d1",
        "--state",
        "declined",
        "--words",
        "no",
        "--revision",
        "2",
        "--text-sha256",
        SHA,
        "--entries",
        "3",
        "--option",
        "b",
        "--by",
        "the session",
      ]),
    ).toEqual({
      kind: "decision",
      action: "report",
      id: "d1",
      state: "declined",
      words: "no",
      revision: 2,
      textSha256: SHA,
      entries: 3,
      option: "b",
      by: "the session",
    });
  });

  it("refuses a report that is missing a required flag", () => {
    expect(errorOf(["decision", "report", "d1"])).toBe("give --state");
    expect(errorOf(["decision", "report", "d1", "--state", "approved"])).toBe(
      "give --words",
    );
    expect(
      errorOf([
        "decision",
        "report",
        "d1",
        "--state",
        "approved",
        "--words",
        "yes",
      ]),
    ).toBe("give --revision");
    expect(
      errorOf([
        "decision",
        "report",
        "d1",
        "--state",
        "approved",
        "--words",
        "yes",
        "--revision",
        "1",
      ]),
    ).toBe("give --text-sha256");
    expect(
      errorOf([
        "decision",
        "report",
        "d1",
        "--state",
        "approved",
        "--words",
        "yes",
        "--revision",
        "1",
        "--text-sha256",
        SHA,
      ]),
    ).toBe("give --entries");
  });

  it("refuses a non-integer revision or entries", () => {
    expect(
      errorOf([
        "decision",
        "report",
        "d1",
        "--state",
        "approved",
        "--words",
        "yes",
        "--revision",
        "abc",
        "--text-sha256",
        SHA,
        "--entries",
        "0",
      ]),
    ).toBe("--revision must be an integer");
    expect(
      errorOf([
        "decision",
        "report",
        "d1",
        "--state",
        "approved",
        "--words",
        "yes",
        "--revision",
        "1",
        "--text-sha256",
        SHA,
        "--entries",
        "abc",
      ]),
    ).toBe("--entries must be an integer");
  });

  it("refuses a --state outside the three", () => {
    expect(
      errorOf([
        "decision",
        "report",
        "d1",
        "--state",
        "open",
        "--words",
        "yes",
        "--revision",
        "1",
        "--text-sha256",
        SHA,
        "--entries",
        "0",
      ]),
    ).toBe("--state must be one of approved, declined, answered");
  });

  it("wants an id for report", () => {
    expect(
      errorOf([
        "decision",
        "report",
        "--state",
        "approved",
        "--words",
        "yes",
        "--revision",
        "1",
        "--text-sha256",
        SHA,
        "--entries",
        "0",
      ]),
    ).toBe("report takes exactly one id");
    expect(
      errorOf([
        "decision",
        "report",
        "d1",
        "extra",
        "--state",
        "approved",
        "--words",
        "yes",
        "--revision",
        "1",
        "--text-sha256",
        SHA,
        "--entries",
        "0",
      ]),
    ).toBe("report takes exactly one id");
    // --wave is a recognised flag, just not one report takes.
    expect(
      errorOf([
        "decision",
        "report",
        "d1",
        "--wave",
        "wv5",
        "--state",
        "approved",
        "--words",
        "yes",
        "--revision",
        "1",
        "--text-sha256",
        SHA,
        "--entries",
        "0",
      ]),
    ).toBe("--wave is not a decision option");
  });

  it("reads a state with its required flags", () => {
    expect(
      commandOf([
        "decision",
        "state",
        "d1",
        "--state",
        "withdrawn",
        "--reason",
        "fixed another way",
        "--revision",
        "1",
        "--text-sha256",
        SHA,
        "--entries",
        "0",
      ]),
    ).toEqual({
      kind: "decision",
      action: "state",
      id: "d1",
      state: "withdrawn",
      revision: 1,
      textSha256: SHA,
      entries: 0,
      reason: "fixed another way",
    });
  });

  it("refuses an answer state for state, pointing at report", () => {
    for (const answer of ["approved", "declined", "answered"]) {
      expect(
        errorOf([
          "decision",
          "state",
          "d1",
          "--state",
          answer,
          "--revision",
          "1",
          "--text-sha256",
          SHA,
          "--entries",
          "0",
        ]),
      ).toBe("use: waves decision report");
    }
  });

  it("refuses a --state outside the three session states", () => {
    expect(
      errorOf([
        "decision",
        "state",
        "d1",
        "--state",
        "open",
        "--revision",
        "1",
        "--text-sha256",
        SHA,
        "--entries",
        "0",
      ]),
    ).toBe("--state must be one of delegated, withdrawn, superseded");
  });

  it("wants an id for state", () => {
    expect(
      errorOf([
        "decision",
        "state",
        "--state",
        "withdrawn",
        "--revision",
        "1",
        "--text-sha256",
        SHA,
        "--entries",
        "0",
      ]),
    ).toBe("state takes exactly one id");
    expect(
      errorOf([
        "decision",
        "state",
        "d1",
        "extra",
        "--state",
        "withdrawn",
        "--revision",
        "1",
        "--text-sha256",
        SHA,
        "--entries",
        "0",
      ]),
    ).toBe("state takes exactly one id");
  });

  it("wants a source and a sub-command", () => {
    expect(errorOf(["decision"])).toBe(
      "decision takes a sub-command: raise, read, report or state",
    );
    expect(errorOf(["decision", "raise"])).toBe("give --file or --stdin");
    expect(errorOf(["decision", "raise", "--file", "x", "--stdin"])).toBe(
      "give only one of --file and --stdin",
    );
    expect(errorOf(["decision", "raise", "--file", "x", "extra"])).toBe(
      "raise takes no arguments",
    );
    expect(errorOf(["decision", "read"])).toBe("read takes exactly one id");
    expect(errorOf(["decision", "read", "d1", "extra"])).toBe(
      "read takes exactly one id",
    );
    expect(errorOf(["decision", "read", "--file", "x"])).toBe(
      "--file is not a decision option",
    );
  });

  it("refuses an unknown decision sub-command", () => {
    expect(errorOf(["decision", "foo"])).toBe(
      "unknown decision sub-command foo",
    );
  });
});

describe("event", () => {
  it("reads a topic, a text and an optional detail", () => {
    expect(
      commandOf(["event", "--topic", "relay", "--text", "Round 4 sent"]),
    ).toEqual({
      kind: "event",
      topic: "relay",
      text: "Round 4 sent",
    });
    expect(
      commandOf([
        "event",
        "--topic",
        "policy",
        "--text",
        "changed the rate limit",
        "--detail",
        "to 5 per minute",
      ]),
    ).toEqual({
      kind: "event",
      topic: "policy",
      text: "changed the rate limit",
      detail: "to 5 per minute",
    });
  });

  it("wants a topic and a text", () => {
    expect(errorOf(["event"])).toBe("give --topic");
    expect(errorOf(["event", "--topic", "relay"])).toBe("give --text");
    expect(errorOf(["event", "--topic", "relay", "--text", "x", "extra"])).toBe(
      "event takes no positional arguments",
    );
    expect(
      errorOf(["event", "--topic", "relay", "--text", "x", "--wave", "w"]),
    ).toBe("--wave is not an event option");
  });
});
