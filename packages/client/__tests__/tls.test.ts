import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:https";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { main } from "../src/index.js";
import {
  environmentOf,
  recorder,
  temporaryDirectory,
} from "./support/harness.js";

const PROJECT = "waves-tls";
const WAVE = "wv5";
const PROJECT_TOKEN = "waves-tls-t0ken-5d3e9a";
const NOW = Date.parse("2026-02-03T04:05:06.789Z");
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

interface Material {
  readonly key: string;
  readonly certificate: string;
}

/**
 * A private key and a self-signed certificate, generated here and now. Nothing
 * is committed: a key in the repository is a secret in the repository, and this
 * one only has to last as long as the test.
 */
async function certificateAuthority(
  directory: string,
): Promise<Material | undefined> {
  const key = join(directory, "key.pem");
  const certificate = join(directory, "cert.pem");
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        key,
        "-out",
        certificate,
        "-days",
        "1",
        "-subj",
        "/CN=127.0.0.1",
        "-addext",
        "subjectAltName=IP:127.0.0.1",
      ],
      { stdio: "ignore" },
    );
  } catch {
    return undefined;
  }
  return {
    key: await readFile(key, "utf8"),
    certificate: await readFile(certificate, "utf8"),
  };
}

let directory: string;
let configDir: string;
let server: Server | undefined;
let origin = "";

beforeAll(async () => {
  directory = (await temporaryDirectory()).path;
  configDir = join(directory, "config");
  const material = await certificateAuthority(directory);
  if (material === undefined) {
    // Where this suite cannot make a certificate, it skips; in CI a skipped
    // test is a hole in the gate, so there it fails instead.
    if (process.env["CI"] !== undefined) {
      throw new Error(
        "openssl is needed to test the pinned certificate authority",
      );
    }
    return;
  }
  server = createServer(
    { key: material.key, cert: material.certificate },
    (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ receivedAt: "2026-02-03T04:05:07.000Z" }));
    },
  );
  await new Promise<void>((resolve) => {
    server?.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the stub has no port");
  }
  origin = `https://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    if (server === undefined) {
      resolve();
      return;
    }
    server.close(() => {
      resolve();
    });
  });
  await rm(directory, { recursive: true, force: true });
});

async function push(caFile: string | undefined): Promise<{
  readonly code: number;
  readonly out: string[];
  readonly err: string[];
}> {
  const recorded = recorder();
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  await writeFile(join(configDir, `${PROJECT}.token`), PROJECT_TOKEN, {
    mode: 0o600,
  });
  const code = await main(
    ["push", "--wave", WAVE, "--stdin", "--include-tails"],
    recorded.io,
    {
      env: environmentOf({
        WAVES_URL: origin,
        WAVES_PROJECT: PROJECT,
        WAVES_CONFIG_DIR: configDir,
        WAVES_CA_FILE: caFile,
      }),
      input: { read: async () => LANES },
      clock: { now: () => NOW },
      sleeper: { sleep: async () => undefined },
    },
  );
  return { code, out: recorded.out, err: recorded.err };
}

describe("the pinned certificate authority", () => {
  it("pushes over https when the server's authority is pinned", async (ctx) => {
    if (origin === "") {
      ctx.skip();
      return;
    }
    const accepted = await push(join(directory, "cert.pem"));
    expect(accepted).toEqual({
      code: 0,
      out: [`pushed ${PROJECT}/${WAVE} at 2026-02-03T04:05:07.000Z`],
      err: [],
    });
  });

  it("refuses a server whose certificate nothing vouches for", async (ctx) => {
    if (origin === "") {
      ctx.skip();
      return;
    }
    const refused = await push(undefined);
    expect(refused.code).toBe(1);
    expect(refused.out).toEqual([]);
    expect(refused.err).toHaveLength(1);
    expect(refused.err[0]).toContain("certificate");
  });
});
