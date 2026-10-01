import { describe, expect, it } from "vitest";

import {
  ConfigError,
  DATA_DIR_VARIABLE,
  HOST_VARIABLE,
  parseConfig,
  PORT_VARIABLE,
  READ_TOKEN_FILE_VARIABLE,
} from "../src/application/config.js";

const DATA_DIR: Record<string, string> = { [DATA_DIR_VARIABLE]: "/srv/waves" };

describe("parseConfig", () => {
  it("falls back to the default host and port", () => {
    expect(parseConfig(DATA_DIR)).toEqual({
      host: "0.0.0.0",
      port: 8080,
      dataDir: "/srv/waves",
      readTokenFile: undefined,
    });
  });

  it("reads every variable", () => {
    expect(
      parseConfig({
        [HOST_VARIABLE]: "127.0.0.1",
        [PORT_VARIABLE]: "18080",
        [DATA_DIR_VARIABLE]: "/var/lib/waves",
        [READ_TOKEN_FILE_VARIABLE]: "/run/secrets/waves-read",
      }),
    ).toEqual({
      host: "127.0.0.1",
      port: 18080,
      dataDir: "/var/lib/waves",
      readTokenFile: "/run/secrets/waves-read",
    });
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
