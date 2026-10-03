import { reasonPhrase, serverFailure } from "../domain/reply.js";
import type { Command } from "../domain/args.js";
import { readProjectList, type ProjectEntry } from "../domain/project-list.js";
import { EXIT_FAILURE, EXIT_OK, UsageError } from "./errors.js";
import type { UseCaseDeps } from "./ports.js";
import {
  readCredential,
  requestRegistration,
  type RegistrationResult,
} from "./registration.js";
import { openSession, tokenPath, transportFor } from "./session.js";

type RegisterAllCommand = Extract<Command, { readonly kind: "register-all" }>;

/** The list the owner maintains, in the directory the tokens live in. */
export const PROJECTS_FILE = "projects.json";

/**
 * How far apart two registrations are sent. The server's write allowance is one
 * a second, so a run that did not wait would spend that allowance on its own
 * second entry and be throttled by a server that had done nothing wrong.
 */
export const REGISTER_SPACING_MS = 1000;

interface Counts {
  skipped: number;
  registered: number;
  conflicts: number;
  failed: number;
}

/**
 * Registers every project in the owner's list that has no token file here, and
 * nothing else.
 *
 * The whole list is read, checked and the credential taken before the first
 * request: a run that failed its fourth entry with a bad fifth entry would have
 * spent four registrations to tell the owner what one line of JSON could have
 * said, and a scheduled run has nobody to answer a question in the middle of.
 *
 * One entry answers at a time and the run goes on. The one answer that stops it
 * is a refused credential, because it is about the token rather than about the
 * project: every entry after it would be refused the same way, and every attempt
 * would be charged to the address's failure allowance. Nothing here rotates: a
 * token that was issued elsewhere is the owner's to recover, and a scheduled
 * job that could replace a token would replace one that still works.
 */
export async function registerAll(
  command: RegisterAllCommand,
  deps: UseCaseDeps,
): Promise<number> {
  const session = await openSession(deps.env, deps.files);
  // Before anything is read or sent: a directory that cannot hold a secret
  // safely is a refusal, and finding that out after the server has minted a
  // token would mean throwing it away.
  await deps.files.checkSecretDirectory(session.configDir);
  const listPath = command.projects ?? `${session.configDir}/${PROJECTS_FILE}`;
  const text = await deps.files.readText(listPath);
  if (text === undefined) {
    throw new UsageError(`no projects file at ${listPath}`);
  }
  const list = readProjectList(text);
  if (!list.ok) {
    throw new UsageError(list.errors.join("; "));
  }
  const bearer = await readCredential(command.credential, deps);
  const transport = transportFor(session, deps);
  const counts: Counts = { skipped: 0, registered: 0, conflicts: 0, failed: 0 };
  let sent = 0;
  for (const entry of list.entries) {
    const path = tokenPath(session.configDir, entry.id);
    try {
      if (await deps.files.exists(path)) {
        // The file is not opened: a stale or unreadable one is still skipped,
        // exactly as `register` treats a token file it cannot read.
        counts.skipped += 1;
        if (command.verbose) {
          deps.out(`skip ${entry.id}: a token file is present`);
        }
        continue;
      }
      if (sent > 0) {
        await deps.sleeper.sleep(REGISTER_SPACING_MS);
      }
      sent += 1;
      const goOn = report(
        entry,
        path,
        await requestRegistration(
          {
            transport,
            origin: session.endpoint.origin,
            bearer,
            project: entry,
            // Nothing in a run like this can rotate: an enrollment token cannot
            // ask for one, and a rotation here would replace a token that works.
            rotate: false,
            path,
          },
          deps,
        ),
        counts,
        deps,
      );
      if (!goOn) {
        break;
      }
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
      // The run has already spent a request, and a summary the owner can read is
      // the point of running it on a schedule. So a file that turned bad
      // mid-list is this entry's line, and not the end of the run.
      counts.failed += 1;
      deps.err(`${entry.id}: ${error.message}`);
    }
  }
  deps.out(
    `${counts.skipped} skipped, ${counts.registered} registered, ${counts.conflicts} conflicts, ${counts.failed} failed`,
  );
  return counts.failed > 0 ? EXIT_FAILURE : EXIT_OK;
}

/**
 * One entry's answer as a line, a count and whether the run goes on.
 *
 * A `409` is a state for the owner rather than a failure of the job: it is
 * printed on every run until it is resolved, and it does not fail the run,
 * because a scheduled job that stopped on it would stop for ever.
 */
function report(
  entry: ProjectEntry,
  path: string,
  result: RegistrationResult,
  counts: Counts,
  deps: UseCaseDeps,
): boolean {
  const id = entry.id;
  if (result.kind === "registered") {
    counts.registered += 1;
    deps.out(`registered ${id}; token saved to ${result.path}`);
    return true;
  }
  if (result.kind === "conflict") {
    counts.conflicts += 1;
    deps.err(
      `${id} is registered and its token is not on this machine (registered elsewhere, or lost after a cut connection); recover it with an admin rotate or remove the entry`,
    );
    return true;
  }
  if (result.kind === "refused") {
    counts.failed += 1;
    if (result.status === 401 || result.status === 403) {
      deps.err(
        `${id}: the server refused the enrollment token for this run, stopping: ${result.status} ${reasonPhrase(result.status)}${serverFailure(result.body)}`,
      );
      return false;
    }
    deps.err(
      `${id}: ${result.status} ${reasonPhrase(result.status)}${serverFailure(result.body)}`,
    );
    return true;
  }
  if (result.kind === "throttled") {
    counts.failed += 1;
    if (result.seconds !== undefined) {
      deps.err(
        `${id}: the server asked to wait ${result.seconds}s, stopping: 429 ${reasonPhrase(429)}`,
      );
      return false;
    }
    deps.err(`${id}: 429 ${reasonPhrase(429)}`);
    return true;
  }
  if (result.kind === "lost") {
    counts.failed += 1;
    deps.err(
      result.sent ? lostToken(id, result.message) : `${id}: ${result.message}`,
    );
    return true;
  }
  counts.failed += 1;
  if (result.reason === "noToken") {
    deps.err(`${id}: the server sent no token`);
    return true;
  }
  deps.err(
    lostToken(
      id,
      result.refusal?.message ??
        `the token was issued but could not be saved to ${path}`,
    ),
  );
  return true;
}

/**
 * The one wording for a token that exists on the server and nowhere on this
 * machine. There is no rotation to point at — a run like this cannot ask for one
 * — so it names the admin rotation that will, and says plainly that the token
 * may already have been issued, because it may have been.
 */
function lostToken(id: string, reason: string): string {
  return `${id}: ${reason}; the token may have been issued and lost; recover it with an admin rotate`;
}
