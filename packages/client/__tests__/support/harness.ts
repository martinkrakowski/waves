import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CliIo } from "../../src/application/entrypoint.js";
import type {
  Environment,
  Files,
  HttpRequest,
  PinRead,
  RunOutcome,
  RunRequest,
  Runner,
  Transport,
  TransportOptions,
  TransportOutcome,
  TransportFactory,
  UseCaseDeps,
} from "../../src/application/ports.js";

/**
 * Secrets with a shape nothing else in the suite produces, so a search for them
 * cannot match by accident.
 */
export const ADMIN_TOKEN = "waves-admin-t0ken-4f19c2";
export const ENROLL_TOKEN = "waves-enroll-t0ken-6c5d90";
export const PROJECT_TOKEN = "waves-project-t0ken-8b7e31";
export const CONFIG_DIR = "/home/waves/.config/waves";
export const PROJECT = "waves-demo";
export const WAVE = "wv5";
export const NOW = Date.parse("2026-02-03T04:05:06.789Z");
export const GENERATED_AT = "2026-02-03T04:05:06.789Z";

/**
 * Everything the suite printed, and every secret it knows about. The leak guard
 * reads both after each test, so a test does not have to remember to check: a
 * line that mentions a secret fails whichever test wrote it.
 */
const printed: string[] = [];
const secrets = new Set<string>([ADMIN_TOKEN, ENROLL_TOKEN, PROJECT_TOKEN]);

/** A secret is a secret whether or not a test named it: the tokens this package
 * issues or reads all carry the same deliberate misspelling, so a line that
 * contains one is caught even if no test registered it.
 */
export const SECRET_SHAPE = /t0ken[^\s"\\]*/;

/**
 * The bearer a request carries, read safely: a `GET` has no bearer at all, and a
 * mutation's is the project's token. Tests use this so a read never has to pretend
 * a token slipped out.
 */
export function bearerOf(request: HttpRequest | undefined): string | undefined {
  if (request === undefined || request.method === "GET") {
    return undefined;
  }
  return request.bearer;
}

export function registerSecret(secret: string): void {
  secrets.add(secret);
}

export function knownSecrets(): readonly string[] {
  return [...secrets];
}

export function printedLines(): readonly string[] {
  return printed;
}

/**
 * Records a line printed outside a `recorder`, so that a test which captures a
 * stream itself — the shell shim's own console, say — is still covered by the
 * leak guard rather than being a way around it.
 */
export function noteOutput(line: string): void {
  printed.push(line);
}

export function forgetPrinted(): void {
  printed.length = 0;
}

export interface Recorder {
  readonly io: CliIo;
  readonly out: string[];
  readonly err: string[];
  /** Everything the command said, in the order the streams were written. */
  lines(): string[];
}

export function recorder(): Recorder {
  const out: string[] = [];
  const err: string[] = [];
  const record = (line: string): void => {
    out.push(line);
    printed.push(line);
  };
  const report = (line: string): void => {
    err.push(line);
    printed.push(line);
  };
  return {
    io: { out: record, err: report },
    out,
    err,
    lines: () => [...out, ...err],
  };
}

export function environmentOf(
  vars: Readonly<Record<string, string | undefined>>,
  home = "/home/waves",
): Environment {
  return { get: (name) => vars[name], home: () => home };
}

export interface FileEntry {
  readonly text: string;
  readonly mode: number;
}

export interface FakeFiles {
  readonly files: Files;
  readonly store: Map<string, FileEntry>;
  readonly writes: { readonly path: string; readonly secret: string }[];
}

export function fakeFiles(
  initial: Readonly<Record<string, FileEntry>> = {},
): FakeFiles {
  const store = new Map<string, FileEntry>(Object.entries(initial));
  const writes: { path: string; secret: string }[] = [];
  return {
    store,
    writes,
    files: {
      readText: async (path) => store.get(path)?.text,
      readSecret: async (path) => store.get(path),
      checkSecretDirectory: async () => undefined,
      exists: async (path) => store.has(path),
      writeSecret: async (path, secret) => {
        writes.push({ path, secret });
        store.set(path, { text: secret, mode: 0o600 });
      },
    },
  };
}

export function reply(
  status: number,
  body = "",
  headers: Readonly<Record<string, string>> = {},
): TransportOutcome {
  return { kind: "reply", reply: { status, headers, body } };
}

export function network(message: string, beforeBody = true): TransportOutcome {
  return { kind: "network", message, beforeBody };
}

export interface ScriptedTransport {
  readonly factory: TransportFactory;
  readonly options: TransportOptions[];
  /** Every request that went out, in the order it went out. */
  readonly requests: HttpRequest[];
  readonly sent: number;
}

export function scriptedTransport(
  script: readonly TransportOutcome[],
): ScriptedTransport {
  const remaining = [...script];
  const options: TransportOptions[] = [];
  const requests: HttpRequest[] = [];
  const state = { sent: 0 };
  const factory: TransportFactory = (received) => {
    options.push(received);
    const transport: Transport = {
      send: async (request) => {
        state.sent += 1;
        requests.push(request);
        const next = remaining.shift();
        if (next === undefined) {
          throw new Error("the scripted transport ran out of answers");
        }
        return next;
      },
    };
    return transport;
  };
  return {
    factory,
    options,
    requests,
    get sent() {
      return state.sent;
    },
  };
}

export interface FakeRunner {
  readonly runner: Runner;
  /** Every program that was asked for, in the order it was asked for. */
  readonly runs: RunRequest[];
}

/**
 * The runner as a script: each run takes the next answer, and a run with none
 * left is a test that asked for more programs than it scripted. `runs` keeps the
 * request, which is where the environment and the deadline of each collector
 * are asserted.
 */
export function fakeRunner(script: readonly RunOutcome[] = []): FakeRunner {
  const remaining = [...script];
  const runs: RunRequest[] = [];
  const runner: Runner = {
    run: async (request) => {
      runs.push(request);
      const next = remaining.shift();
      if (next === undefined) {
        throw new Error("the fake runner ran out of answers");
      }
      return next;
    },
  };
  return { runner, runs };
}

export interface Harness {
  readonly io: CliIo;
  readonly out: string[];
  readonly err: string[];
  readonly deps: UseCaseDeps;
  readonly waits: number[];
  readonly transportOptions: TransportOptions[];
  readonly requests: HttpRequest[];
  readonly sent: () => number;
  readonly files: FakeFiles;
  readonly runs: RunRequest[];
}

export interface HarnessInput {
  readonly script?: readonly TransportOutcome[];
  /** The answers the fake runner gives, one per collector. */
  readonly runs?: readonly RunOutcome[];
  readonly vars?: Readonly<Record<string, string | undefined>>;
  readonly files?: Readonly<Record<string, FileEntry>>;
  readonly stdin?: string;
  readonly now?: number;
  /** What the pin port answers, for a `read --signed` that expects one. */
  readonly pins?: PinRead;
  /** A clock of the test's own, for a run that measures how long it took. */
  readonly clock?: { now(): number };
}

/**
 * Every port as a fake, so a use case can be exercised end to end without a
 * socket, a disk or a timer. `WAVES_URL` is loopback plain http, which is the
 * one way the client is allowed to speak http without the override.
 */
export function harness(input: HarnessInput = {}): Harness {
  const recorded = recorder();
  const waits: number[] = [];
  const scripted = scriptedTransport(input.script ?? []);
  const programs = fakeRunner(input.runs ?? []);
  const files = fakeFiles(input.files ?? {});
  const stdin = input.stdin ?? "";
  const deps: UseCaseDeps = {
    env: environmentOf({
      WAVES_URL: "http://127.0.0.1:8080",
      WAVES_PROJECT: PROJECT,
      ...input.vars,
    }),
    files: files.files,
    input: { read: async () => stdin },
    clock: input.clock ?? { now: () => input.now ?? NOW },
    sleeper: {
      sleep: async (ms) => {
        waits.push(ms);
      },
    },
    transport: scripted.factory,
    runner: programs.runner,
    ownerPins: { read: async () => input.pins ?? { kind: "missing" } },
    out: recorded.io.out,
    err: recorded.io.err,
  };
  return {
    io: recorded.io,
    out: recorded.out,
    err: recorded.err,
    deps,
    waits,
    transportOptions: scripted.options,
    requests: scripted.requests,
    sent: () => scripted.sent,
    files,
    runs: programs.runs,
  };
}

export async function temporaryDirectory(): Promise<{
  readonly path: string;
  readonly remove: () => Promise<void>;
}> {
  const path = await mkdtemp(join(tmpdir(), "waves-client-"));
  return { path, remove: () => rm(path, { recursive: true, force: true }) };
}

/** A lane as a project would write it: one lane, with a log tail in it. */
export function laneWithTail(tail: string): Record<string, unknown> {
  return {
    id: "wv5",
    reported: { stage: "build", event: "settled", ts: GENERATED_AT },
    derived: { alive: false, log: { bytes: 4096, mtimeMs: NOW, tail } },
    disagreements: [],
  };
}

/** The same lane once the client has taken the tail out of it. */
export function laneWithoutTail(): Record<string, unknown> {
  return {
    id: "wv5",
    reported: { stage: "build", event: "settled", ts: GENERATED_AT },
    derived: { alive: false, log: { bytes: 4096, mtimeMs: NOW } },
    disagreements: [],
  };
}

export function lanesOnly(tail: string): string {
  return JSON.stringify({ lanes: [laneWithTail(tail)] });
}
