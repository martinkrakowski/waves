import {
  isLaneId,
  isProjectId,
  isWaveId,
} from "@hexagen-monaco/waves-contract";

import { flagIssues, readProjectRequest } from "./project-request.js";

export const USAGE = [
  "usage:",
  "  waves register <id> --name <name> [--repo <https-url>] [--rotate]",
  "                 (--admin-token-file <path> | --admin-token-stdin)",
  "                 | (--enrollment-token-file <path> | --enrollment-token-stdin)",
  "  waves register-all (--enrollment-token-file <path> | --enrollment-token-stdin)",
  "                     [--projects <path>] [--verbose]",
  "  waves push --wave <wave> (--file <path> | --stdin)",
  "                [--interval <1-300>] [--include-tails]",
  "  waves status (--file <path> | --stdin) [--interval <1-300>]",
  "  waves delete --wave <wave>",
  "  waves sync [--check]",
  "  waves decision raise --file <path|->",
  "  waves decision read <id> [--signed]",
  "  waves decision report <id> --state ... --words <text> --revision <n> --text-sha256 <hex> --entries <k> [--option <key>] [--by <text>]",
  "  waves decision state <id> --state ... --revision <n> --text-sha256 <hex> --entries <k> [--reason <text>] [--superseded-by <id>] [--option <key>] [--words <text>] [--by <text>]",
  "  waves event --topic <topic> --text <text> [--detail <text>]",
  "  waves decisions export [--since <YYYY-MM-DD>]",
  "",
  `WAVES_URL is required. WAVES_PROJECT names the project a push, a status or`,
  "a delete belongs to. The project token is read from the file",
  "~/.config/waves/<project>.token, which WAVES_CONFIG_DIR overrides.",
  "waves sync takes no arguments: it reads the projects to look after out of",
  "~/.config/waves/sync.json. --check reads that file and prints the period it",
  "would use, running nothing.",
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
  | {
      readonly kind: "status";
      readonly source: InputSource;
      readonly intervalSeconds: number | null;
    }
  | {
      /** The whole schedule is in `sync.json`, so there is nothing to say here. */
      readonly kind: "sync";
      /** Read the configuration and print the period, starting nothing. */
      readonly check: boolean;
    }
  | { readonly kind: "delete"; readonly wave: string }
  | {
      readonly kind: "decision";
      readonly action: "raise";
      readonly source: InputSource;
    }
  | {
      readonly kind: "decision";
      readonly action: "read";
      readonly id: string;
      /** Verify the current signed answer against the pinned owner keys. */
      readonly signed: boolean;
    }
  | {
      readonly kind: "decision";
      readonly action: "report";
      readonly id: string;
      readonly state: string;
      readonly words: string;
      readonly revision: number;
      readonly textSha256: string;
      readonly entries: number;
      readonly option?: string;
      readonly by?: string;
    }
  | {
      readonly kind: "decision";
      readonly action: "state";
      readonly id: string;
      readonly state: string;
      readonly revision: number;
      readonly textSha256: string;
      readonly entries: number;
      readonly reason?: string;
      readonly supersededBy?: string;
      readonly option?: string;
      readonly words?: string;
      readonly by?: string;
    }
  | {
      readonly kind: "decision";
      readonly action: "raise";
      readonly source: InputSource;
    }
  | {
      readonly kind: "event";
      readonly topic: string;
      readonly text: string;
      readonly detail?: string;
    }
  | {
      readonly kind: "decisions";
      readonly action: "export";
      readonly since: string | null;
    };

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
 * `--check` asks whether the file could be run at all, which is a question about
 * the schedule and not a change to it: the same file, read the same way, with the
 * same answer for a tick and for an installer. It is here rather than as a
 * separate command because the reading is `sync`'s own and there is no second one
 * to keep in step with it.
 */
const CHECK = "--check";

/** The one flag `decision read` takes: verify, not just fetch. */
const SIGNED = "--signed";

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
  "--state",
  "--words",
  "--revision",
  "--text-sha256",
  "--entries",
  "--option",
  "--by",
  "--reason",
  "--superseded-by",
  "--since",
  "--topic",
  "--text",
  "--detail",
] as const;

const SWITCH_FLAGS = [
  "--rotate",
  "--admin-token-stdin",
  "--enrollment-token-stdin",
  "--verbose",
  "--stdin",
  "--include-tails",
  SIGNED,
  CHECK,
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
const STATUS_FLAGS: readonly string[] = ["--file", "--stdin", "--interval"];
/** `sync` is configured by a file, so `--check` is the only flag it takes. */
const SYNC_FLAGS: readonly string[] = [CHECK];

const DECISION_RAISE_FLAGS: readonly string[] = ["--file", "--stdin"];
const DECISION_READ_FLAGS: readonly string[] = [SIGNED];
const DECISION_REPORT_FLAGS: readonly string[] = [
  "--state",
  "--words",
  "--revision",
  "--text-sha256",
  "--entries",
  "--option",
  "--by",
];
const DECISION_STATE_FLAGS: readonly string[] = [
  "--state",
  "--revision",
  "--text-sha256",
  "--entries",
  "--reason",
  "--superseded-by",
  "--option",
  "--words",
  "--by",
];
const EVENT_FLAGS: readonly string[] = ["--topic", "--text", "--detail"];
const DECISIONS_EXPORT_FLAGS: readonly string[] = ["--since"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const REPORT_STATES = ["approved", "declined", "answered"] as const;
const STATE_STATES = ["delegated", "withdrawn", "superseded"] as const;
const FLAG_INTEGER = /^\d+$/;

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
    head !== "status" &&
    head !== "sync" &&
    head !== "delete" &&
    head !== "decision" &&
    head !== "event" &&
    head !== "decisions"
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
  if (head === "status") {
    return readStatus(tokens);
  }
  if (head === "sync") {
    return readSync(tokens);
  }
  if (head === "delete") {
    return readDelete(tokens);
  }
  if (head === "decision") {
    return readDecision(tokens);
  }
  if (head === "event") {
    return readEvent(tokens);
  }
  return readDecisions(tokens);
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

function readStatus(tokens: Tokens): ParseResult {
  const unused = firstUnused(tokens, STATUS_FLAGS);
  if (unused !== undefined) {
    return { ok: false, error: `${unused} is not a status option` };
  }
  if (tokens.positionals.length !== 0) {
    return { ok: false, error: "status takes no positional arguments" };
  }
  const source = readInputSource(tokens);
  if (typeof source === "string") {
    return { ok: false, error: source };
  }
  const intervalSeconds = readInterval(tokens.values.get("--interval"));
  if (typeof intervalSeconds === "string") {
    return { ok: false, error: intervalSeconds };
  }
  return { ok: true, command: { kind: "status", source, intervalSeconds } };
}

function readSync(tokens: Tokens): ParseResult {
  // Every flag but --check is refused, because there is nothing here a caller
  // could change: which projects to look after and how often is the file's
  // business, and a flag that looked as if it did something would be worse than
  // none.
  const unused = firstUnused(tokens, SYNC_FLAGS);
  if (unused !== undefined) {
    return { ok: false, error: `${unused} is not a sync option` };
  }
  if (tokens.positionals.length !== 0) {
    return { ok: false, error: "sync takes no positional arguments" };
  }
  return {
    ok: true,
    command: { kind: "sync", check: tokens.switches.has(CHECK) },
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
  if (path === "-") {
    return { kind: "stdin" };
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

function readDecision(tokens: Tokens): ParseResult {
  const action = tokens.positionals[0];
  if (action === undefined) {
    return {
      ok: false,
      error: "decision takes a sub-command: raise, read, report or state",
    };
  }
  if (action === "raise") {
    return readDecisionRaise(tokens);
  }
  if (action === "read") {
    return readDecisionRead(tokens);
  }
  if (action === "report") {
    return readDecisionReport(tokens);
  }
  if (action === "state") {
    return readDecisionState(tokens);
  }
  return { ok: false, error: `unknown decision sub-command ${action}` };
}

function readDecisionRaise(tokens: Tokens): ParseResult {
  const unused = firstUnused(tokens, DECISION_RAISE_FLAGS);
  if (unused !== undefined) {
    return { ok: false, error: `${unused} is not a decision option` };
  }
  if (tokens.positionals.length !== 1) {
    return { ok: false, error: "raise takes no arguments" };
  }
  const source = readInputSource(tokens);
  if (typeof source === "string") {
    return { ok: false, error: source };
  }
  return { ok: true, command: { kind: "decision", action: "raise", source } };
}

function readDecisionRead(tokens: Tokens): ParseResult {
  const unused = firstUnused(tokens, DECISION_READ_FLAGS);
  if (unused !== undefined) {
    return { ok: false, error: `${unused} is not a decision option` };
  }
  const id = tokens.positionals[1];
  if (id === undefined || tokens.positionals.length !== 2) {
    return { ok: false, error: "read takes exactly one id" };
  }
  if (!isLaneId(id)) {
    return { ok: false, error: `${id} is not a decision id` };
  }
  return {
    ok: true,
    command: {
      kind: "decision",
      action: "read",
      id,
      signed: tokens.switches.has(SIGNED),
    },
  };
}

function readDecisionReport(tokens: Tokens): ParseResult {
  const unused = firstUnused(tokens, DECISION_REPORT_FLAGS);
  if (unused !== undefined) {
    return { ok: false, error: `${unused} is not a decision option` };
  }
  const id = tokens.positionals[1];
  if (id === undefined || tokens.positionals.length !== 2) {
    return { ok: false, error: "report takes exactly one id" };
  }
  if (!isLaneId(id)) {
    return { ok: false, error: `${id} is not a decision id` };
  }
  const state = tokens.values.get("--state");
  if (state === undefined) {
    return { ok: false, error: "give --state" };
  }
  if (!(REPORT_STATES as readonly string[]).includes(state)) {
    return {
      ok: false,
      error: `--state must be one of ${REPORT_STATES.join(", ")}`,
    };
  }
  const words = tokens.values.get("--words");
  if (words === undefined) {
    return { ok: false, error: "give --words" };
  }
  const revision = readIntegerFlag(tokens, "--revision");
  if (typeof revision === "string") {
    return { ok: false, error: revision };
  }
  const textSha256 = tokens.values.get("--text-sha256");
  if (textSha256 === undefined) {
    return { ok: false, error: "give --text-sha256" };
  }
  const entries = readIntegerFlag(tokens, "--entries");
  if (typeof entries === "string") {
    return { ok: false, error: entries };
  }
  return {
    ok: true,
    command: {
      kind: "decision",
      action: "report",
      id,
      state,
      words,
      revision,
      textSha256,
      entries,
      option: tokens.values.get("--option"),
      by: tokens.values.get("--by"),
    },
  };
}

function readDecisionState(tokens: Tokens): ParseResult {
  const unused = firstUnused(tokens, DECISION_STATE_FLAGS);
  if (unused !== undefined) {
    return { ok: false, error: `${unused} is not a decision option` };
  }
  const id = tokens.positionals[1];
  if (id === undefined || tokens.positionals.length !== 2) {
    return { ok: false, error: "state takes exactly one id" };
  }
  if (!isLaneId(id)) {
    return { ok: false, error: `${id} is not a decision id` };
  }
  const supersededBy = tokens.values.get("--superseded-by");
  if (supersededBy !== undefined && !isLaneId(supersededBy)) {
    return { ok: false, error: `${supersededBy} is not a decision id` };
  }
  const state = tokens.values.get("--state");
  if (state === undefined) {
    return { ok: false, error: "give --state" };
  }
  // The three answer states belong to report, not state: naming one of them
  // here is a steer rather than an argument.
  if ((REPORT_STATES as readonly string[]).includes(state)) {
    return { ok: false, error: "use: waves decision report" };
  }
  if (!(STATE_STATES as readonly string[]).includes(state)) {
    return {
      ok: false,
      error: `--state must be one of ${STATE_STATES.join(", ")}`,
    };
  }
  const revision = readIntegerFlag(tokens, "--revision");
  if (typeof revision === "string") {
    return { ok: false, error: revision };
  }
  const textSha256 = tokens.values.get("--text-sha256");
  if (textSha256 === undefined) {
    return { ok: false, error: "give --text-sha256" };
  }
  const entries = readIntegerFlag(tokens, "--entries");
  if (typeof entries === "string") {
    return { ok: false, error: entries };
  }
  return {
    ok: true,
    command: {
      kind: "decision",
      action: "state",
      id,
      state,
      revision,
      textSha256,
      entries,
      reason: tokens.values.get("--reason"),
      supersededBy,
      option: tokens.values.get("--option"),
      words: tokens.values.get("--words"),
      by: tokens.values.get("--by"),
    },
  };
}

function readIntegerFlag(tokens: Tokens, flag: string): number | string {
  const raw = tokens.values.get(flag);
  if (raw === undefined) {
    return `give ${flag}`;
  }
  if (!FLAG_INTEGER.test(raw)) {
    return `${flag} must be an integer`;
  }
  return Number(raw);
}

function readEvent(tokens: Tokens): ParseResult {
  const unused = firstUnused(tokens, EVENT_FLAGS);
  if (unused !== undefined) {
    return { ok: false, error: `${unused} is not an event option` };
  }
  if (tokens.positionals.length !== 0) {
    return { ok: false, error: "event takes no positional arguments" };
  }
  const topic = tokens.values.get("--topic");
  if (topic === undefined) {
    return { ok: false, error: "give --topic" };
  }
  const text = tokens.values.get("--text");
  if (text === undefined) {
    return { ok: false, error: "give --text" };
  }
  return {
    ok: true,
    command: {
      kind: "event",
      topic,
      text,
      detail: tokens.values.get("--detail"),
    },
  };
}

function readSince(
  raw: string | undefined,
): { ok: true; since: string | null } | { ok: false; error: string } {
  if (raw === undefined) {
    return { ok: true, since: null };
  }
  if (!DATE_PATTERN.test(raw)) {
    return { ok: false, error: "--since must be a date in YYYY-MM-DD form" };
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return { ok: false, error: "--since must be a real date" };
  }
  if (date.toISOString().slice(0, 10) !== raw) {
    return { ok: false, error: "--since must be a real date" };
  }
  return { ok: true, since: raw };
}

function readDecisions(tokens: Tokens): ParseResult {
  const unused = firstUnused(tokens, DECISIONS_EXPORT_FLAGS);
  if (unused !== undefined) {
    return { ok: false, error: `${unused} is not a decisions option` };
  }
  if (tokens.positionals.length === 0) {
    return {
      ok: false,
      error: "decisions takes a sub-command: export",
    };
  }
  const action = tokens.positionals[0];
  if (action !== "export") {
    return { ok: false, error: `unknown decisions sub-command ${action}` };
  }
  if (tokens.positionals.length !== 1) {
    return { ok: false, error: "export takes no arguments" };
  }
  const since = readSince(tokens.values.get("--since"));
  if (!since.ok) {
    return { ok: false, error: since.error };
  }
  return {
    ok: true,
    command: { kind: "decisions", action: "export", since: since.since },
  };
}

export function commandName(command: Command): string {
  switch (command.kind) {
    case "help":
      return WAVES;
    case "register":
      return `${WAVES} register`;
    case "register-all":
      return `${WAVES} register-all`;
    case "push":
      return `${WAVES} push`;
    case "status":
      return `${WAVES} status`;
    case "delete":
      return `${WAVES} delete`;
    case "sync":
      return `${WAVES} sync`;
    case "decision":
      return `${WAVES} decision ${command.action}`;
    case "event":
      return `${WAVES} event`;
    case "decisions":
      return `${WAVES} decisions ${command.action}`;
  }
}
