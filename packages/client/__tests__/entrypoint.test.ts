import { describe, expect, it } from "vitest";

import { run } from "../src/application/entrypoint.js";
import { USAGE } from "../src/domain/args.js";
import { FileRefusal } from "../src/application/ports.js";
import {
  CONFIG_DIR,
  PROJECT,
  PROJECT_TOKEN,
  WAVE,
  harness,
  network,
  reply,
} from "./support/harness.js";

const tokenPath = `${CONFIG_DIR}/${PROJECT}.token`;

describe("run", () => {
  it("prints the usage and exits 2 when there is no command", async () => {
    const built = harness();
    expect(await run([], built.io, built.deps)).toBe(2);
    expect(built.err).toEqual(["waves: no command given", USAGE]);
    expect(built.out).toEqual([]);
  });

  it("prints the usage and exits 0 when it is asked for", async () => {
    const built = harness();
    expect(await run(["--help"], built.io, built.deps)).toBe(0);
    expect(built.out).toEqual([USAGE]);
    expect(built.err).toEqual([]);
  });

  it("names a command it does not have", async () => {
    const built = harness();
    expect(await run(["publish"], built.io, built.deps)).toBe(2);
    expect(built.err[0]).toBe("waves: unknown command publish");
  });

  it("registers, pushes and deletes", async () => {
    const registered = harness({
      script: [reply(201, `{"id":"${PROJECT}","token":"${PROJECT_TOKEN}"}`)],
      stdin: "admin-t0ken",
    });
    expect(
      await run(
        ["register", PROJECT, "--name", "Waves Demo", "--admin-token-stdin"],
        registered.io,
        registered.deps,
      ),
    ).toBe(0);
    expect(registered.out).toEqual([
      `registered ${PROJECT}; token saved to ${tokenPath}`,
    ]);

    const pushed = harness({
      script: [reply(200, '{"receivedAt":"2026-02-03T04:05:07.001Z"}')],
      stdin: '{"lanes":[]}',
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });
    expect(
      await run(["push", "--wave", WAVE, "--stdin"], pushed.io, pushed.deps),
    ).toBe(0);
    expect(pushed.out).toEqual([
      `pushed ${PROJECT}/${WAVE} at 2026-02-03T04:05:07.001Z`,
    ]);

    const deleted = harness({
      script: [reply(204)],
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });
    expect(
      await run(["delete", "--wave", WAVE], deleted.io, deleted.deps),
    ).toBe(0);
    expect(deleted.out).toEqual([`deleted ${PROJECT}/${WAVE}`]);
  });

  it("reports a refusal of the command line or the configuration, and exits 2", async () => {
    const built = harness({ vars: { WAVES_PROJECT: undefined } });
    expect(
      await run(["push", "--wave", WAVE, "--stdin"], built.io, built.deps),
    ).toBe(2);
    expect(built.err).toEqual(["waves push: WAVES_PROJECT is required"]);
  });

  it("reports a server that said no, and exits 1", async () => {
    const lost = network("connect ECONNREFUSED");
    const built = harness({
      script: [lost, lost, lost],
      stdin: '{"lanes":[]}',
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });
    expect(
      await run(["push", "--wave", WAVE, "--stdin"], built.io, built.deps),
    ).toBe(1);
    expect(built.err).toEqual([
      "waves push: push failed: connect ECONNREFUSED",
    ]);
    expect(built.waits).toEqual([1000, 2000]);
  });

  it("reports a failure of a registration, and exits 1", async () => {
    const built = harness({ script: [reply(401, "")], stdin: "admin-t0ken" });
    expect(
      await run(
        ["register", PROJECT, "--name", "Waves Demo", "--admin-token-stdin"],
        built.io,
        built.deps,
      ),
    ).toBe(1);
    expect(built.err).toEqual([
      "waves register: register failed: 401 Unauthorized",
    ]);
  });

  it("lets a bug travel out rather than dressing it up as an answer", async () => {
    const built = harness();
    const broken = {
      ...built.deps,
      files: {
        readText: async () => undefined,
        readSecret: async () => undefined,
        checkSecretDirectory: async () => undefined,
        exists: () => {
          throw "not even an error";
        },
        writeSecret: async () => undefined,
      },
    };
    await expect(
      run(
        ["register", PROJECT, "--name", "Waves Demo", "--admin-token-stdin"],
        built.io,
        broken,
      ),
    ).rejects.toBe("not even an error");
  });

  it("labels a refused decision command with its name", async () => {
    const built = harness({ vars: { WAVES_PROJECT: undefined } });
    expect(
      await run(["decision", "raise", "--stdin"], built.io, built.deps),
    ).toBe(2);
    expect(built.err).toEqual([
      "waves decision raise: WAVES_PROJECT is required",
      "waves decision raise: not raised; fix the configuration, or ask in the terminal",
    ]);
  });

  it("labels a refused event command with its name", async () => {
    const built = harness({
      vars: { WAVES_PROJECT: undefined },
    });
    expect(
      await run(
        ["event", "--topic", "relay", "--text", "ok"],
        built.io,
        built.deps,
      ),
    ).toBe(2);
    expect(built.err).toEqual(["waves event: WAVES_PROJECT is required"]);
  });

  it("labels a refused decisions command with its name", async () => {
    const built = harness({
      vars: { WAVES_PROJECT: undefined },
    });
    expect(await run(["decisions", "export"], built.io, built.deps)).toBe(2);
    expect(built.err).toEqual([
      "waves decisions export: WAVES_PROJECT is required",
    ]);
  });

  it("reports a file it will not read, and exits 2", async () => {
    const built = harness({
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });
    const broken = {
      ...built.deps,
      files: {
        ...built.deps.files,
        readSecret: async () => {
          throw new FileRefusal("/path is a link");
        },
      },
    };
    expect(await run(["decision", "raise", "--stdin"], built.io, broken)).toBe(
      2,
    );
    expect(built.err).toEqual([
      "waves decision raise: /path is a link",
      "waves decision raise: not raised; fix the configuration, or ask in the terminal",
    ]);
  });

  it("propagates an unexpected token-file error instead of swallowing it", async () => {
    const built = harness({
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });
    const broken = {
      ...built.deps,
      files: {
        ...built.deps.files,
        readSecret: async () => {
          throw "not even an error";
        },
      },
    };
    await expect(
      run(["decision", "raise", "--stdin"], built.io, broken),
    ).rejects.toBe("not even an error");
    expect(built.err).toEqual([]);
    expect(built.sent()).toBe(0);
  });

  describe("read exit 0 is not an answer", () => {
    it("reads a decision and prints the body, without the owner's answer", async () => {
      const body = JSON.stringify({
        head: {
          id: "d1",
          question: "q",
          state: "approved",
          source: "reported",
          at: "2026-10-08T10:00:00Z",
          revision: 1,
          textSha256: "abc",
        },
        revisions: [],
        entries: [],
      });
      const built = harness({ script: [reply(200, body)] });
      expect(await run(["decision", "read", "d1"], built.io, built.deps)).toBe(
        0,
      );
      expect(built.out).toEqual([body]);
      expect(built.err).toEqual([]);
    });
  });

  it("labels a refused decision report with its name", async () => {
    const built = harness({ vars: { WAVES_PROJECT: undefined } });
    expect(
      await run(
        [
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
          "a".repeat(64),
          "--entries",
          "0",
        ],
        built.io,
        built.deps,
      ),
    ).toBe(2);
    expect(built.err).toEqual([
      "waves decision report: WAVES_PROJECT is required",
    ]);
  });

  it("labels a refused decision state with its name", async () => {
    const built = harness({ vars: { WAVES_PROJECT: undefined } });
    expect(
      await run(
        [
          "decision",
          "state",
          "d1",
          "--state",
          "withdrawn",
          "--revision",
          "1",
          "--text-sha256",
          "a".repeat(64),
          "--entries",
          "0",
        ],
        built.io,
        built.deps,
      ),
    ).toBe(2);
    expect(built.err).toEqual([
      "waves decision state: WAVES_PROJECT is required",
    ]);
  });
});
