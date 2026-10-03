import { isProjectId, isWaveId } from "@hexagen-monaco/waves-contract";

import { flagIssues, readProjectRequest } from "./project-request.js";
import { carriesCredentials } from "./endpoint.js";

export const USAGE = [
  "usage:",
  "  waves register <id> --name <name> [--repo <https-url>] [--rotate]",
  "                 (--admin-token-file <path> | --admin-token-stdin)",
  "                 | (--enrollment-token-file <path> | --enrollment-token-stdin)",
  "  waves register-all (--enrollment-token-file <path> | --enrollment-token-stdin)",
  "                     [--projects <path>] [--verbose]",
  "  waves push --wave <wave> (--file <path> | --stdin)",
  "                [--interval <1-300>] [--include-tails]",
  "  waves delete --wave <wave>",
  "",
  `WAVES_URL is required. WAVES_PROJECT names the project a push or a delete`,
  "belongs to. The project token is read from ~/.config/waves/<project>.token,",
  "which WAVES_CONFIG_DIR overrides.",
].join("\n");

/** Where a token comes from. Never from argv and never from the environment. */
export type TokenSource =
  { readonly kind: "file"; readonly path: string } | { readonly kind: "stdin" };

export type InputSource =
  { readonly kind: "file"; readonly path: string } | { readonly kind: "stdin" };

/**
 * A token and what it is allowed to do, which is the only thing that separates
 * the two: the admin token does everything, and an enrollment token can only
 * create a project that is not there yet. The role is carried with the source
 * rather than worked out where the token is read, so the file or stdin a
 * credential came from is a question with the same answer for both roles and
 * only the wording of a refusal differs.
 */
export interface Credential {
  readonly role: "admin" | "enrollment";
  readonly source: TokenSource;
}

export type Command =
  | { readonly kind: "help" }
  | {
      readonly kind: "register";
      readonly id: string;
      readonly name: string;
      readonly repo?: string;
      readonly rotate: boolean;
      readonly credential: Credential;
    }
  | {
      readonly kind: "register-all";
      readonly credential: Credential;
      /** The list to read, or `undefined` for the one in the config directory. */
      readonly projects: string | undefined;
      readonly verbose: boolean;
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

/** The two flags one role's token may come from, and what it would mean. */
interface CredentialChoice {
  readonly role: Credential["role"];
  /** Takes a path, so it is a value flag rather than a switch. */
  readonly file: string;
  readonly stdin: string;
}

const ADMIN_CHOICE: CredentialChoice = {
  role: "admin",
  file: "--admin-token-file",
  stdin: "--admin-token-stdin",
};
const ENROLLMENT_CHOICE: CredentialChoice = {
  role: "enrollment",
  file: "--enrollment-token-file",
  stdin: "--enrollment-token-stdin",
};
const ADMIN_FLAGS: readonly string[] = [ADMIN_CHOICE.file, ADMIN_CHOICE.stdin];
const ENROLLMENT_FLAGS: readonly string[] = [
  ENROLLMENT_CHOICE.file,
  ENROLLMENT_CHOICE.stdin,
];
const CREDENTIAL_FLAGS: readonly string[] = [
  ...ADMIN_FLAGS,
  ...ENROLLMENT_FLAGS,
];

const ROTATE = "--rotate";

/**
 * `--rotate` asks the server for a token it will only ever send once, so it is
 * refused here rather than sent: an enrollment token cannot replace a token, and
 * a request that would invalidate a token the user still depends on must not
 * leave the machine. This is a parse error, so it is exit 2, before any file is
 * opened and before any byte goes out.
 */
const ROTATE_NEEDS_ADMIN =
  "--rotate needs the admin token; an enrollment token can only register a new project";

const VALUE_FLAGS = [
  "--name",
  "--repo",
  "--admin-token-file",
  "--enrollment-token-file",
  "--projects",
  "--wave",
  "--file",
  "--interval",
] as const;

const SWITCH_FLAGS = [
  "--rotate",
  "--admin-token-stdin",
  "--enrollment-token-stdin",
  "--verbose",
  "--stdin",
  "--include-tails",
] as const;

const REGISTER_FLAGS: readonly string[] = [
  "--name",
  "--repo",
  "--rotate",
  ...CREDENTIAL_FLAGS,
];
const REGISTER_ALL_FLAGS: readonly string[] = [
  "--projects",
  "--verbose",
  ...ENROLLMENT_FLAGS,
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
  if (
    head !== "register" &&
    head !== "register-all" &&
    head !== "push" &&
    head !== "delete"
  ) {
    return { ok: false, error: `unknown command ${head}` };
  }
  const tokens = tokenize(argv);
  if (typeof tokens === "string") {
    return { ok: false, error: tokens };
  }
  if (head === "register") {
    return readRegister(tokens);
  }
  if (head === "register-all") {
    return readRegisterAll(tokens);
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
  const credential = readRegisterCredential(tokens);
  if (typeof credential === "string") {
    return { ok: false, error: credential };
  }
  return {
    ok: true,
    command: {
      kind: "register",
      id,
      name,
      repo,
      rotate: tokens.switches.has(ROTATE),
      credential,
    },
  };
}

function readRegisterAll(tokens: Tokens): ParseResult {
  const unused = firstUnused(tokens, REGISTER_ALL_FLAGS);
  if (unused !== undefined) {
    return { ok: false, error: `${unused} is not a register-all option` };
  }
  if (tokens.positionals.length !== 0) {
    return { ok: false, error: "register-all takes no positional arguments" };
  }
  const credential = readCredential(tokens, [ENROLLMENT_CHOICE]);
  if (typeof credential === "string") {
    return { ok: false, error: credential };
  }
  return {
    ok: true,
    command: {
      kind: "register-all",
      credential,
      projects: tokens.values.get("--projects"),
      verbose: tokens.switches.has("--verbose"),
    },
  };
}

interface Candidate {
  readonly choice: CredentialChoice;
  readonly source: TokenSource;
}

/**
 * Every credential flag the caller gave, with the source it stands for. Both
 * flags of one role are reported rather than the first one only, because a user
 * who gave two needs to be told which pair was the mistake.
 */
function candidates(
  tokens: Tokens,
  choices: readonly CredentialChoice[],
): Candidate[] {
  const found: Candidate[] = [];
  for (const choice of choices) {
    const path = tokens.values.get(choice.file);
    if (path !== undefined) {
      found.push({ choice, source: { kind: "file", path } });
    }
    if (tokens.switches.has(choice.stdin)) {
      found.push({ choice, source: { kind: "stdin" } });
    }
  }
  return found;
}

/**
 * `a, b and c` — the shape a refusal needs when it names the flags it was given.
 * The last one is separated so that `give only one of a, b and c` reads as a
 * sentence rather than as a list.
 */
function listOf(flags: readonly string[], last: string): string {
  return `${flags.slice(0, -1).join(", ")} ${last} ${flags.slice(-1).join("")}`;
}

/**
 * Exactly one of the flags a command accepts, from exactly one role. A token
 * given twice is a mistake about where it is, and saying so before anything is
 * read is the whole point: a credential is never opened for a command line that
 * cannot work.
 */
function readCredential(
  tokens: Tokens,
  choices: readonly CredentialChoice[],
): Credential | string {
  const flags = choices.flatMap((choice) => [choice.file, choice.stdin]);
  const [first, ...rest] = candidates(tokens, choices);
  if (first === undefined) {
    return `give ${listOf(flags, "or")}`;
  }
  if (rest.length > 0) {
    return `give only one of ${listOf(flags, "and")}`;
  }
  return { role: first.choice.role, source: first.source };
}

/**
 * `register` takes either role, and the two never meet: an admin token is the
 * owner's, an enrollment token is a run's. What the role forbids is checked
 * here, where nothing has been read and nothing has been sent.
 */
function readRegisterCredential(tokens: Tokens): Credential | string {
  const credential = readCredential(tokens, [ADMIN_CHOICE, ENROLLMENT_CHOICE]);
  if (typeof credential === "string") {
    return credential;
  }
  if (credential.role === "enrollment" && tokens.switches.has(ROTATE)) {
    return ROTATE_NEEDS_ADMIN;
  }
  return credential;
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
  "register-all": `${WAVES} register-all`,
  push: `${WAVES} push`,
  delete: `${WAVES} delete`,
};
