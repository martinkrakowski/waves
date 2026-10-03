import { describe, expect, it } from "vitest";

import {
  ADMIN_TOKEN_FILE_VARIABLE,
  ConfigError,
  DATA_DIR_VARIABLE,
  ENROLL_TOKEN_FILE_VARIABLE,
  HOST_VARIABLE,
  parseConfig,
  PORT_VARIABLE,
  READ_TOKEN_FILE_VARIABLE,
  TRUST_PROXY_VARIABLE,
} from "../src/application/config.js";

const DATA_DIR: Record<string, string> = { [DATA_DIR_VARIABLE]: "/srv/waves" };

describe("parseConfig", () => {
  it("falls back to the default host and port", () => {
    expect(parseConfig(DATA_DIR)).toEqual({
      host: "0.0.0.0",
      port: 8080,
      dataDir: "/srv/waves",
      readTokenFile: undefined,
      adminTokenFile: undefined,
      enrollTokenFile: undefined,
      trustProxy: false,
    });
  });

  it("reads every variable", () => {
    expect(
      parseConfig({
        [HOST_VARIABLE]: "127.0.0.1",
        [PORT_VARIABLE]: "18080",
        [DATA_DIR_VARIABLE]: "/var/lib/waves",
        [READ_TOKEN_FILE_VARIABLE]: "/run/secrets/waves-read",
        [ADMIN_TOKEN_FILE_VARIABLE]: "/run/secrets/waves-admin/token",
        [ENROLL_TOKEN_FILE_VARIABLE]: "/run/secrets/waves-enroll/token",
        [TRUST_PROXY_VARIABLE]: "1",
      }),
    ).toEqual({
      host: "127.0.0.1",
      port: 18080,
      dataDir: "/var/lib/waves",
      readTokenFile: "/run/secrets/waves-read",
      adminTokenFile: "/run/secrets/waves-admin/token",
      enrollTokenFile: "/run/secrets/waves-enroll/token",
      trustProxy: true,
    });
  });

  it("takes the enrollment file on its own, as an optional one", () => {
    expect(
      parseConfig({
        ...DATA_DIR,
        [ENROLL_TOKEN_FILE_VARIABLE]: "/run/secrets/waves-enroll/token",
      }),
    ).toMatchObject({
      adminTokenFile: undefined,
      enrollTokenFile: "/run/secrets/waves-enroll/token",
    });
  });

  it.each(["", "2", "true", "01", " 1"])(
    "rejects the trust proxy setting %j",
    (trustProxy) => {
      expect(() =>
        parseConfig({ ...DATA_DIR, [TRUST_PROXY_VARIABLE]: trustProxy }),
      ).toThrow(TRUST_PROXY_VARIABLE);
    },
  );

  it("accepts trust proxy 0 and 1", () => {
    for (const [value, expected] of [
      ["0", false],
      ["1", true],
    ] as const) {
      expect(
        parseConfig({ ...DATA_DIR, [TRUST_PROXY_VARIABLE]: value }).trustProxy,
      ).toBe(expected);
    }
  });

  it("rejects an empty admin token file path", () => {
    expect(() =>
      parseConfig({ ...DATA_DIR, [ADMIN_TOKEN_FILE_VARIABLE]: "" }),
    ).toThrow(ADMIN_TOKEN_FILE_VARIABLE);
  });

  it("rejects an empty enrollment token file path", () => {
    expect(() =>
      parseConfig({ ...DATA_DIR, [ENROLL_TOKEN_FILE_VARIABLE]: "" }),
    ).toThrow(ENROLL_TOKEN_FILE_VARIABLE);
  });

  it("never reads a token value from the environment", () => {
    // The two variables name a file and nothing else: a value set beside them
    // under any spelling is not configuration this service reads.
    const parsed = parseConfig({
      ...DATA_DIR,
      [ADMIN_TOKEN_FILE_VARIABLE]: "/run/secrets/waves-admin/token",
      [ENROLL_TOKEN_FILE_VARIABLE]: "/run/secrets/waves-enroll/token",
      WAVES_ENROLL_TOKEN: "in-the-environment-0123456789abcdefghij",
      WAVES_ADMIN_TOKEN: "in-the-environment-0123456789abcdefghij",
    });

    expect(JSON.stringify(parsed)).not.toContain("in-the-environment");
  });

  it.each(["1", "8080", "65535"])("accepts the port %j", (port) => {
    expect(parseConfig({ ...DATA_DIR, [PORT_VARIABLE]: port }).port).toBe(
      Number(port),
    );
  });

  it.each([
    "0",
    "65536",
    "99999",
    "abc",
    "80.5",
    " 8080",
    "8080 ",
    "",
    "8.0e3",
  ])("rejects the port %j", (port) => {
    expect(() => parseConfig({ ...DATA_DIR, [PORT_VARIABLE]: port })).toThrow(
      ConfigError,
    );
    expect(() => parseConfig({ ...DATA_DIR, [PORT_VARIABLE]: port })).toThrow(
      PORT_VARIABLE,
    );
  });

  it.each(["waves internal", "", " ", "a".repeat(256)])(
    "rejects the host %j",
    (host) => {
      expect(() => parseConfig({ ...DATA_DIR, [HOST_VARIABLE]: host })).toThrow(
        HOST_VARIABLE,
      );
    },
  );

  it("accepts a long but sane host", () => {
    expect(
      parseConfig({ ...DATA_DIR, [HOST_VARIABLE]: "a".repeat(255) }).host,
    ).toBe("a".repeat(255));
  });

  it("requires the data directory", () => {
    expect(() => parseConfig({})).toThrow(
      new ConfigError(DATA_DIR_VARIABLE, "is required"),
    );
  });

  it.each(["", "   "])("rejects the empty data directory %j", (dataDir) => {
    expect(() => parseConfig({ [DATA_DIR_VARIABLE]: dataDir })).toThrow(
      DATA_DIR_VARIABLE,
    );
  });

  it("rejects an empty read token file path", () => {
    expect(() =>
      parseConfig({ ...DATA_DIR, [READ_TOKEN_FILE_VARIABLE]: "" }),
    ).toThrow(READ_TOKEN_FILE_VARIABLE);
  });

  it("names the offending variable in the message", () => {
    let thrown: unknown;
    try {
      parseConfig({ ...DATA_DIR, [PORT_VARIABLE]: "0" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ConfigError);
    expect((thrown as ConfigError).variable).toBe(PORT_VARIABLE);
    expect((thrown as ConfigError).message).toBe(
      `${PORT_VARIABLE} must be between 1 and 65535`,
    );
  });
});
