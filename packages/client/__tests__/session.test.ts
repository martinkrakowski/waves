import { describe, expect, it } from "vitest";

import { UsageError } from "../src/application/errors.js";
import { FileRefusal } from "../src/application/ports.js";
import {
  openSession,
  readProject,
  readProjectToken,
  readTokenFor,
  tokenPath,
  transportFor,
} from "../src/application/session.js";
import {
  CONFIG_DIR,
  PROJECT,
  PROJECT_TOKEN,
  environmentOf,
  fakeFiles,
  harness,
} from "./support/harness.js";

async function refusalOf(
  vars: Readonly<Record<string, string | undefined>>,
  files = fakeFiles(),
): Promise<string> {
  try {
    await openSession(environmentOf(vars), files.files);
  } catch (error) {
    if (error instanceof UsageError) {
      return error.message;
    }
    throw error;
  }
  throw new Error(`expected ${JSON.stringify(vars)} to be refused`);
}

describe("openSession", () => {
  it("wants WAVES_URL", async () => {
    expect(await refusalOf({})).toBe("WAVES_URL is required");
  });

  it("refuses a URL that is not an origin", async () => {
    expect(await refusalOf({ WAVES_URL: "ftp://waves.example.com" })).toBe(
      "WAVES_URL must use http: or https:",
    );
  });

  it("allows plain http to a loopback host", async () => {
    const session = await openSession(
      environmentOf({ WAVES_URL: "http://127.0.0.1:8080" }),
      fakeFiles().files,
    );
    expect(session.endpoint).toEqual({
      origin: "http://127.0.0.1:8080",
      secure: false,
      warnInsecure: false,
    });
  });

  it("refuses plain http elsewhere, unless the override allows it", async () => {
    expect(
      await refusalOf({ WAVES_URL: "http://waves.example.com" }),
    ).toContain("WAVES_ALLOW_INSECURE_HTTP=1");
    const session = await openSession(
      environmentOf({
        WAVES_URL: "http://waves.example.com",
        WAVES_ALLOW_INSECURE_HTTP: "1",
      }),
      fakeFiles().files,
    );
    expect(session.endpoint.warnInsecure).toBe(true);
  });

  it("ignores an override that is switched off", async () => {
    expect(
      await refusalOf({
        WAVES_URL: "http://waves.example.com",
        WAVES_ALLOW_INSECURE_HTTP: "0",
      }),
    ).toContain("WAVES_ALLOW_INSECURE_HTTP=1");
  });

  it("takes the config directory from WAVES_CONFIG_DIR", async () => {
    const session = await openSession(
      environmentOf({
        WAVES_URL: "https://waves.example.com",
        WAVES_CONFIG_DIR: "/run/waves",
      }),
      fakeFiles().files,
    );
    expect(session.configDir).toBe("/run/waves");
  });

  it("falls back to ~/.config/waves", async () => {
    const session = await openSession(
      environmentOf({ WAVES_URL: "https://waves.example.com" }),
      fakeFiles().files,
    );
    expect(session.configDir).toBe(CONFIG_DIR);
  });

  it("pins a configured certificate authority", async () => {
    const files = fakeFiles({ "/run/ca.pem": { text: "PEM", mode: 0o644 } });
    const session = await openSession(
      environmentOf({
        WAVES_URL: "https://waves.example.com",
        WAVES_CA_FILE: "/run/ca.pem",
      }),
      files.files,
    );
    expect(session.ca).toBe("PEM");
  });

  it("refuses a certificate authority it cannot read", async () => {
    expect(
      await refusalOf({
        WAVES_URL: "https://waves.example.com",
        WAVES_CA_FILE: "/run/missing.pem",
      }),
    ).toBe("WAVES_CA_FILE /run/missing.pem cannot be read");
  });

  it("picks up a ca.crt in the config directory when there is one", async () => {
    const files = fakeFiles({
      "/run/waves/ca.crt": { text: "PEM", mode: 0o644 },
    });
    const session = await openSession(
      environmentOf({
        WAVES_URL: "https://waves.example.com",
        WAVES_CONFIG_DIR: "/run/waves",
      }),
      files.files,
    );
    expect(session.ca).toBe("PEM");
  });

  it("uses the system store when there is no ca.crt", async () => {
    const session = await openSession(
      environmentOf({ WAVES_URL: "https://waves.example.com" }),
      fakeFiles().files,
    );
    expect(session.ca).toBeUndefined();
  });
});

describe("readProject", () => {
  it("wants WAVES_PROJECT, and a project id in it", () => {
    expect(() => readProject(environmentOf({}))).toThrow(UsageError);
    expect(() => readProject(environmentOf({}))).toThrow(
      "WAVES_PROJECT is required",
    );
    expect(() => readProject(environmentOf({ WAVES_PROJECT: " " }))).toThrow(
      "WAVES_PROJECT is required",
    );
    expect(() =>
      readProject(environmentOf({ WAVES_PROJECT: "Waves" })),
    ).toThrow("WAVES_PROJECT Waves is not a project id");
    expect(readProject(environmentOf({ WAVES_PROJECT: PROJECT }))).toBe(
      PROJECT,
    );
  });
});

describe("readProjectToken", () => {
  const session = {
    endpoint: {
      origin: "https://waves.example.com",
      secure: true,
      warnInsecure: false,
    },
    configDir: "/run/waves",
  };
  const env = environmentOf({ WAVES_PROJECT: PROJECT });

  it("names where the token should be", async () => {
    await expect(
      readProjectToken(session, fakeFiles().files, env),
    ).rejects.toThrow("no token for waves-demo at /run/waves/waves-demo.token");
  });

  it("refuses an empty token file", async () => {
    const files = fakeFiles({
      "/run/waves/waves-demo.token": { text: "\n", mode: 0o600 },
    });
    await expect(readProjectToken(session, files.files, env)).rejects.toThrow(
      "/run/waves/waves-demo.token is empty",
    );
  });

  it("returns the token, trimmed", async () => {
    const files = fakeFiles({
      "/run/waves/waves-demo.token": {
        text: `${PROJECT_TOKEN}\n`,
        mode: 0o600,
      },
    });
    expect(await readProjectToken(session, files.files, env)).toEqual({
      project: PROJECT,
      token: PROJECT_TOKEN,
    });
  });

  it("passes on the refusal of an adapter that will not open the file", async () => {
    const refusal = new FileRefusal("/run/waves/waves-demo.token: ELOOP");
    const files = fakeFiles();
    await expect(
      readProjectToken(
        session,
        {
          ...files.files,
          readSecret: async () => {
            throw refusal;
          },
        },
        env,
      ),
    ).rejects.toBe(refusal);
  });
});

describe("readTokenFor", () => {
  const session = {
    endpoint: {
      origin: "https://waves.example.com",
      secure: true,
      warnInsecure: false,
    },
    configDir: "/run/waves",
  };

  it("reads the file of the project it was given, not the environment's", async () => {
    const files = fakeFiles({
      "/run/waves/waves-demo.token": { text: "demo\n", mode: 0o600 },
      "/run/waves/client-portal.token": { text: "portal\n", mode: 0o600 },
    });

    expect(await readTokenFor(session, files.files, "client-portal")).toEqual({
      project: "client-portal",
      token: "portal",
    });
    expect(await readTokenFor(session, files.files, "waves-demo")).toEqual({
      project: "waves-demo",
      token: "demo",
    });
  });

  it("names where the token of a project it cannot read should be", async () => {
    await expect(
      readTokenFor(session, fakeFiles().files, "client-portal"),
    ).rejects.toThrow(
      "no token for client-portal at /run/waves/client-portal.token",
    );
  });
});

describe("tokenPath", () => {
  it("puts every token in the config directory", () => {
    expect(tokenPath("/run/waves", PROJECT)).toBe(
      "/run/waves/waves-demo.token",
    );
  });
});

describe("transportFor", () => {
  const secure = {
    origin: "https://waves.example.com",
    secure: true,
    warnInsecure: false,
  };

  it("hands the origin and the authority to the transport", () => {
    const built = harness();
    transportFor(
      { endpoint: secure, ca: "PEM", configDir: "/run/waves" },
      built.deps,
    );
    expect(built.transportOptions).toEqual([
      {
        origin: "https://waves.example.com",
        ca: "PEM",
        warnInsecure: undefined,
      },
    ]);
  });

  it("gives the transport a warning to print on every request when it must", () => {
    const built = harness();
    transportFor(
      {
        endpoint: {
          origin: "http://10.0.0.4:8080",
          secure: false,
          warnInsecure: true,
        },
        configDir: "/run/waves",
      },
      built.deps,
    );
    built.transportOptions[0]?.warnInsecure?.({
      method: "GET",
      url: "http://10.0.0.4:8080/api/v1/projects/d1",
    });
    expect(built.err).toEqual([
      "waves: http://10.0.0.4:8080 is plain http, so the response is fetched in clear text",
    ]);
  });
});
