import { isProjectId, isWaveId } from "@hexagen-monaco/waves-contract";

import { flagIssues, readProjectRequest } from "./project-request.js";
import { carriesCredentials } from "./endpoint.js";

export const USAGE = [
  "usage:",
  "  waves register <id> --name <name> [--repo <https-url>] [--rotate]",
  "                 (--admin-token-file <path> | --admin-token-stdin)",
  "  waves push --wave <wave> (--file <path> | --stdin)",
  "                [--interval <1-300>] [--include-tails]",
  "  waves delete --wave <wave>",
  "",
  `WAVES_URL is required. WAVES_PROJECT names the project a push or a delete`,
  "belongs to. The project token is read from ~/.config/waves/<project>.token,",
  "which WAVES_CONFIG_DIR overrides.",
].join("\n");

/** Where the admin token comes from. Never from argv and never from the environment. */
export type AdminTokenSource =
  { readonly kind: "file"; readonly path: string } | { readonly kind: "stdin" };

export type InputSource =
  { readonly kind: "file"; readonly path: string } | { readonly kind: "stdin" };

export type Command =
  | { readonly kind: "help" }
  | {
      readonly kind: "register";
      readonly id: string;
      readonly name: string;
      readonly repo?: string;
      readonly rotate: boolean;
      readonly adminToken: AdminTokenSource;
    }
  | {
      readonly kind: "push";
      readonly wave: string;
      readonly source: InputSource;
      readonly intervalSeconds: number | null;
      readonly includeTails: boolean;
    }
  | { readonly kind: "delete"; readonly wave: string };

export type ParseResult =
  | { readonly ok: true; readonly command: Command }
  | { readonly ok: false; readonly error: string };

const VALUE_FLAGS = [
  "--name",
  "--repo",
  "--admin-token-file",
  "--wave",
  "--file",
  "--interval",
] as const;

const SWITCH_FLAGS = [
  "--rotate",
  "--admin-token-stdin",
  "--stdin",
  "--include-tails",
] as const;

const REGISTER_FLAGS: readonly string[] = [
  "--name",
  "--repo",
  "--rotate",
  "--admin-token-file",
  "--admin-token-stdin",
];
const PUSH_FLAGS: readonly string[] = [
  "--wave",
  "--file",
  "--stdin",
  "--interval",
  "--include-tails",
];
const DELETE_FLAGS: readonly string[] = ["--wave"];

const MIN_INTERVAL_SECONDS = 1;
const MAX_INTERVAL_SECONDS = 300;
const INTEGER = /^\d{1,3}$/;
const WAVES = "waves";
const HELP_FLAGS = ["--help", "-h"];

interface Tokens {
  /** Keyed by the flag itself, so a refusal can name it. */
  readonly values: ReadonlyMap<string, string>;
  readonly switches: ReadonlySet<string>;
  readonly positionals: readonly string[];
}

export function parseArgv(argv: readonly string[]): ParseResult {
  const head = argv[0];
  if (head === undefined) {
    return { ok: false, error: "no command given" };
  }
  if (head === "help" || HELP_FLAGS.includes(head)) {
    return { ok: true, command: { kind: "help" } };
  }
  if (head !== "register" && head !== "push" && head !== "delete") {
    return { ok: false, error: `unknown command ${head}` };
  }
  const tokens = tokenize(argv);
  if (typeof tokens === "string") {
    return { ok: false, error: tokens };
  }
  if (head === "register") {
    return readRegister(tokens);
  }
  if (head === "push") {
    return readPush(tokens);
  }
  return readDelete(tokens);
}

function tokenize(argv: readonly string[]): Tokens | string {
  const values = new Map<string, string>();
  const switches = new Set<string>();
  const positionals: string[] = [];
  const args = argv.slice(1);
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index]);
    if ((VALUE_FLAGS as readonly string[]).includes(arg)) {
      const next = args[index + 1];
      if (next === undefined || next === "" || next.startsWith("--")) {
        return `${arg} needs a value`;
      }
      if (values.has(arg)) {
        return `${arg} was given twice`;
      }
      values.set(arg, next);
      index += 1;
    } else if ((SWITCH_FLAGS as readonly string[]).includes(arg)) {
      if (switches.has(arg)) {
        return `${arg} was given twice`;
      }
      switches.add(arg);
    } else if (arg.startsWith("-")) {
      return `unknown option ${arg}`;
    } else {
      positionals.push(arg);
    }
  }
  return { values, switches, positionals };
}

function firstUnused(
  tokens: Tokens,
  allowed: readonly string[],
): string | undefined {
  for (const flag of [...tokens.values.keys(), ...tokens.switches]) {
    if (!allowed.includes(flag)) {
      return flag;
    }
  }
  return undefined;
}

function readRegister(tokens: Tokens): ParseResult {
  const unused = firstUnused(tokens, REGISTER_FLAGS);
  if (unused !== undefined) {
    return { ok: false, error: `${unused} is not a register option` };
  }
  if (tokens.positionals.length !== 1) {
    return { ok: false, error: "register takes exactly one project id" };
  }
  const id = tokens.positionals.join(" ");
  if (!isProjectId(id)) {
    return { ok: false, error: `${id} is not a project id` };
  }
  const name = (tokens.values.get("--name") ?? "").trim();
  const repo = tokens.values.get("--repo");
  const refused = readProjectRequest({ id, name, repo });
  if (refused.length > 0) {
    return { ok: false, error: flagIssues(refused).join("; ") };
  }
  // The contract would store a repo URL that carries a password; the status page
  // would then render it.
  if (repo !== undefined && carriesCredentials(repo)) {
    return { ok: false, error: "--repo must not carry a user or a password" };
  }
  const adminToken = readAdminTokenSource(tokens);
  if (typeof adminToken === "string") {
    return { ok: false, error: adminToken };
  }
  return {
    ok: true,
    command: {
      kind: "register",
      id,
      name,
      repo,
      rotate: tokens.switches.has("--rotate"),
      adminToken,
    },
  };
}

function readAdminTokenSource(tokens: Tokens): AdminTokenSource | string {
  const path = tokens.values.get("--admin-token-file");
  const fromStdin = tokens.switches.has("--admin-token-stdin");
  if (path !== undefined && fromStdin) {
    return "give only one of --admin-token-file and --admin-token-stdin";
  }
  if (path === undefined) {
    return fromStdin
      ? { kind: "stdin" }
      : "give --admin-token-file or --admin-token-stdin";
  }
  return { kind: "file", path };
}

function readPush(tokens: Tokens): ParseResult {
  const unused = firstUnused(tokens, PUSH_FLAGS);
  if (unused !== undefined) {
    return { ok: false, error: `${unused} is not a push option` };
  }
  if (tokens.positionals.length !== 0) {
    return { ok: false, error: "push takes no positional arguments" };
  }
  const wave = readWave(tokens);
  if ("error" in wave) {
    return { ok: false, error: wave.error };
  }
  const source = readInputSource(tokens);
  if (typeof source === "string") {
    return { ok: false, error: source };
  }
  const intervalSeconds = readInterval(tokens.values.get("--interval"));
  if (typeof intervalSeconds === "string") {
    return { ok: false, error: intervalSeconds };
  }
  return {
    ok: true,
    command: {
      kind: "push",
      wave: wave.wave,
      source,
      intervalSeconds,
      includeTails: tokens.switches.has("--include-tails"),
    },
  };
}

function readDelete(tokens: Tokens): ParseResult {
  const unused = firstUnused(tokens, DELETE_FLAGS);
  if (unused !== undefined) {
    return { ok: false, error: `${unused} is not a delete option` };
  }
  if (tokens.positionals.length !== 0) {
    return { ok: false, error: "delete takes no positional arguments" };
  }
  const wave = readWave(tokens);
  if ("error" in wave) {
    return { ok: false, error: wave.error };
  }
  return { ok: true, command: { kind: "delete", wave: wave.wave } };
}

type WaveResult = { readonly wave: string } | { readonly error: string };

function readWave(tokens: Tokens): WaveResult {
  const wave = tokens.values.get("--wave");
  if (wave === undefined) {
    return { error: "--wave is required" };
  }
  if (!isWaveId(wave)) {
    return { error: `${wave} is not a wave id` };
  }
  return { wave };
}

function readInputSource(tokens: Tokens): InputSource | string {
  const path = tokens.values.get("--file");
  const fromStdin = tokens.switches.has("--stdin");
  if (path !== undefined && fromStdin) {
    return "give only one of --file and --stdin";
  }
  if (path === undefined) {
    return fromStdin ? { kind: "stdin" } : "give --file or --stdin";
  }
  return { kind: "file", path };
}

function readInterval(raw: string | undefined): number | null | string {
  if (raw === undefined) {
    return null;
  }
  const seconds = Number(raw);
  if (
    !INTEGER.test(raw) ||
    seconds < MIN_INTERVAL_SECONDS ||
    seconds > MAX_INTERVAL_SECONDS
  ) {
    return `--interval must be a whole number of seconds between ${MIN_INTERVAL_SECONDS} and ${MAX_INTERVAL_SECONDS}`;
  }
  return seconds;
}

export const COMMAND_NAME: Readonly<Record<Command["kind"], string>> = {
  help: WAVES,
  register: `${WAVES} register`,
  push: `${WAVES} push`,
  delete: `${WAVES} delete`,
};
