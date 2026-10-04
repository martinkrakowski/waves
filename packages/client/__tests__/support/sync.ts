import type { RunOutcome } from "../../src/application/ports.js";
import { CONFIG_DIR, PROJECT_TOKEN } from "./harness.js";

/**
 * What a `sync.json` and its collectors are made of, in one place, so a test says
 * what it is testing rather than how a file is spelled.
 */

/** The program a collector is. Absolute, because the file has to say so. */
export const COLLECTOR = "/usr/local/bin/waves-collect";
export const COLLECTOR_DIR = "/srv/demo";

export const SYNC_FILE = `${CONFIG_DIR}/sync.json`;

export function syncFile(
  projects: readonly unknown[],
  over: Record<string, unknown> = {},
): string {
  return JSON.stringify({ projects, ...over });
}

export function entry(
  project: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return { project, command: [COLLECTOR], cwd: COLLECTOR_DIR, ...over };
}

export function tokenPathOf(project: string): string {
  return `${CONFIG_DIR}/${project}.token`;
}

/** The token files of these projects, tight enough to be read. */
export function tokenFiles(
  ...projects: readonly string[]
): Record<string, { readonly text: string; readonly mode: number }> {
  const files: Record<string, { text: string; mode: number }> = {};
  for (const project of projects) {
    files[tokenPathOf(project)] = { text: `${PROJECT_TOKEN}\n`, mode: 0o600 };
  }
  return files;
}

/** One collector's stdout: a wave per id, and optionally a status. */
export function printed(
  waves: readonly string[],
  status?: unknown,
  lanes: readonly unknown[] = [],
): string {
  return JSON.stringify({
    waves: waves.map((wave) => ({ wave, lanes })),
    ...(status === undefined ? {} : { status }),
  });
}

/** A collector's answer: an exit, unless the test is about another outcome. */
export function exited(
  stdout: string,
  over: Partial<{
    readonly code: number | null;
    readonly stderr: string;
    readonly stderrTruncated: boolean;
  }> = {},
): RunOutcome {
  return {
    kind: "exit",
    code: over.code === undefined ? 0 : over.code,
    stdout,
    stderr: over.stderr ?? "",
    stderrTruncated: over.stderrTruncated ?? false,
  };
}

/**
 * A clock the test moves by hand, for the questions a constant one cannot answer:
 * what a run does when a tick has only so much time left in it.
 */
export function handClock(start = 0): {
  readonly clock: { now(): number };
  pass(ms: number): void;
} {
  let now = start;
  return { clock: { now: () => now }, pass: (ms) => (now += ms) };
}
