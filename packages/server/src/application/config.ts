export type Env = Readonly<Record<string, string | undefined>>;

export interface Config {
  readonly host: string;
  readonly port: number;
  readonly dataDir: string;
  readonly readTokenFile?: string;
  readonly adminTokenFile?: string;
  readonly enrollTokenFile?: string;
  /**
   * Whether `X-Forwarded-For` and `X-Forwarded-Proto` are the address and the
   * scheme of the client, rather than of the proxy in front of this process.
   */
  readonly trustProxy: boolean;
}

export const HOST_VARIABLE = "WAVES_HOST";
export const PORT_VARIABLE = "WAVES_PORT";
export const DATA_DIR_VARIABLE = "WAVES_DATA_DIR";
export const READ_TOKEN_FILE_VARIABLE = "WAVES_READ_TOKEN_FILE";
export const ADMIN_TOKEN_FILE_VARIABLE = "WAVES_ADMIN_TOKEN_FILE";
export const ENROLL_TOKEN_FILE_VARIABLE = "WAVES_ENROLL_TOKEN_FILE";
export const TRUST_PROXY_VARIABLE = "WAVES_TRUST_PROXY";

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 8080;
const MIN_PORT = 1;
const MAX_PORT = 65535;
const PORT_PATTERN = /^[0-9]{1,5}$/;
const MAX_HOST_LENGTH = 255;
const WHITESPACE = /\s/;

export class ConfigError extends Error {
  readonly variable: string;

  constructor(variable: string, requirement: string) {
    super(`${variable} ${requirement}`);
    this.variable = variable;
    this.name = "ConfigError";
  }
}

function optional(env: Env, variable: string): string | undefined {
  const value = env[variable];
  if (value === undefined) {
    return undefined;
  }
  if (value.trim() === "") {
    throw new ConfigError(variable, "must not be empty");
  }
  return value;
}

function readHost(env: Env): string {
  const host = optional(env, HOST_VARIABLE);
  if (host === undefined) {
    return DEFAULT_HOST;
  }
  if (host.length > MAX_HOST_LENGTH || WHITESPACE.test(host)) {
    throw new ConfigError(HOST_VARIABLE, "is not a valid host");
  }
  return host;
}

function readPort(env: Env): number {
  const raw = optional(env, PORT_VARIABLE);
  if (raw === undefined) {
    return DEFAULT_PORT;
  }
  if (!PORT_PATTERN.test(raw)) {
    throw new ConfigError(PORT_VARIABLE, "must be a number");
  }
  const port = Number(raw);
  if (port < MIN_PORT || port > MAX_PORT) {
    throw new ConfigError(
      PORT_VARIABLE,
      `must be between ${MIN_PORT} and ${MAX_PORT}`,
    );
  }
  return port;
}

function readDataDir(env: Env): string {
  const dataDir = optional(env, DATA_DIR_VARIABLE);
  if (dataDir === undefined) {
    throw new ConfigError(DATA_DIR_VARIABLE, "is required");
  }
  return dataDir;
}

/**
 * Behind a proxy that is trusted to overwrite the forwarding headers, this is
 * `1` and the client is the last entry of `X-Forwarded-For` with its scheme
 * read from `X-Forwarded-Proto`. Anywhere else it is `0` and every forwarding
 * header is ignored, so a client cannot spend another address's failure
 * allowance, or claim a scheme it does not have.
 */
function readTrustProxy(env: Env): boolean {
  const raw = env[TRUST_PROXY_VARIABLE];
  if (raw === undefined) {
    return false;
  }
  if (raw !== "0" && raw !== "1") {
    throw new ConfigError(TRUST_PROXY_VARIABLE, "must be 0 or 1");
  }
  return raw === "1";
}

export function parseConfig(env: Env): Config {
  return {
    host: readHost(env),
    port: readPort(env),
    dataDir: readDataDir(env),
    readTokenFile: optional(env, READ_TOKEN_FILE_VARIABLE),
    adminTokenFile: optional(env, ADMIN_TOKEN_FILE_VARIABLE),
    enrollTokenFile: optional(env, ENROLL_TOKEN_FILE_VARIABLE),
    trustProxy: readTrustProxy(env),
  };
}
