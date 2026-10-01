import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { main } from "../src/index.js";
import { recorder, temporaryDirectory } from "./support/harness.js";
import {
  STUB_ADMIN_TOKEN,
  startStub,
  type Stub,
} from "./support/stub-server.js";

const PROJECT = "waves-defaults";
const WAVE = "wv5";

const LANES = JSON.stringify({
  lanes: [
    {
      id: "wv5",
      reported: {
        stage: "build",
        event: "settled",
        ts: "2026-02-03T04:05:06.789Z",
      },
      derived: { alive: false },
      disagreements: [],
    },
  ],
});

const originalEnv = { ...process.env };

let stub: Stub;
let directory: string;
let configDir: string;

beforeAll(async () => {
  // This file pushes through `main` with the real system clock.
  stub = await startStub({ now: Date.now });
  directory = (await temporaryDirectory()).path;
  configDir = join(directory, "config");
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, originalEnv);
});

afterAll(async () => {
  await stub.stop();
  await rm(directory, { recursive: true, force: true });
});

describe("main", () => {
  it("answers a question with nothing but argv and the two streams", async () => {
    const recorded = recorder();
    expect(await main(["help"], recorded.io)).toBe(0);
    expect(recorded.out).toHaveLength(1);
    expect(recorded.err).toEqual([]);
  });

  it("refuses an unknown command with nothing but argv and the two streams", async () => {
    const recorded = recorder();
    expect(await main(["publish"], recorded.io)).toBe(2);
    expect(recorded.err[0]).toBe("waves: unknown command publish");
  });

  it("registers and pushes against a real server with the real filesystem", async () => {
    await mkdir(configDir, { recursive: true, mode: 0o700 });
    const adminFile = join(directory, "admin.token");
    await writeFile(adminFile, `${STUB_ADMIN_TOKEN}\n`, { mode: 0o600 });
    const statusFile = join(directory, "status.json");
    await writeFile(statusFile, LANES, { mode: 0o644 });
    process.env.WAVES_URL = stub.origin;
    process.env.WAVES_PROJECT = PROJECT;
    process.env.WAVES_CONFIG_DIR = configDir;

    const registered = recorder();
    expect(
      await main(
        [
          "register",
          PROJECT,
          "--name",
          "Waves Demo",
          "--admin-token-file",
          adminFile,
        ],
        registered.io,
      ),
    ).toBe(0);

    const pushed = recorder();
    expect(
      await main(["push", "--wave", WAVE, "--file", statusFile], pushed.io),
    ).toBe(0);
    expect(pushed.out[0]).toMatch(new RegExp(`^pushed ${PROJECT}/${WAVE} at `));
    // The clock the real one read is inside the envelope the server took.
    expect(stub.requests.some((entry) => entry.body.includes('"lanes"'))).toBe(
      true,
    );
  });
});
