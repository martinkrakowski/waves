export type Env = Readonly<Record<string, string | undefined>>;

export interface Config {
  readonly host: string;
  readonly port: number;
  readonly dataDir: string;
  readonly readTokenFile?: string;
}

export const HOST_VARIABLE = "WAVES_HOST";
export const PORT_VARIABLE = "WAVES_PORT";
export const DATA_DIR_VARIABLE = "WAVES_DATA_DIR";
export const READ_TOKEN_FILE_VARIABLE = "WAVES_READ_TOKEN_FILE";

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

export function parseConfig(env: Env): Config {
  return {
    host: readHost(env),
    port: readPort(env),
    dataDir: readDataDir(env),
    readTokenFile: optional(env, READ_TOKEN_FILE_VARIABLE),
  };
}
