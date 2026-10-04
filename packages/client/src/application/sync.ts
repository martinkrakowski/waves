import {
  readSyncConfig,
  type SyncConfig,
  type SyncProject,
} from "../domain/sync-config.js";
import { EXIT_FAILURE, EXIT_OK, Failure, UsageError } from "./errors.js";
import { FileRefusal, type UseCaseDeps } from "./ports.js";
import { collect } from "./collector-run.js";
import { pacedTransport } from "./paced.js";
import { sendProjectStatus, sendWave } from "./send.js";
import {
  openSession,
  readTokenFor,
  SYNC_CONFIG_FILE,
  syncConfigPath,
  transportFor,
  type Session,
} from "./session.js";

const SECOND_MS = 1000;

/** A session and the schedule it found, which is all a tick needs to start. */
interface Schedule {
  readonly session: Session;
  readonly config: SyncConfig;
}

/**
 * One run of every project in `sync.json`, and then this process exits.
 *
 * The timer is launchd's, not this client's: there is no loop here and no sleep
 * between ticks, so a crash costs one tick and a sleeping machine lets every wave
 * go stale — which is what the dashboard is for. A run that outlasts its period
 * makes launchd skip a fire, and the budget below is what keeps that rare.
 *
 * Every project is somebody else's failure or nobody's. A refused configuration
 * is the run's own, and nothing is started at all; everything else is one line on
 * stderr for that project and the run goes on to the next, because a scheduled
 * run has nobody to answer a question in the middle of and one project's collector
 * must not cost the others their tick.
 */
export async function sync(deps: UseCaseDeps): Promise<number> {
  const { session, config } = await readSchedule(deps);
  const started = deps.clock.now();
  const deadline = started + config.every * SECOND_MS;
  let failed = false;
  for (const project of rotation(config, started)) {
    if (deps.clock.now() >= deadline) {
      // Not started, not sent, and not pushed: this project reads stale until the
      // next tick, which is a failure of the run rather than a quiet tick.
      failed = true;
      deps.err(`${label(project)}: skipped, out of time`);
      continue;
    }
    failed =
      (await runProject(session, config, project, deadline, deps)) || failed;
  }
  return failed ? EXIT_FAILURE : EXIT_OK;
}

/**
 * Whether the schedule could be run at all, answered as the one number an
 * installer needs: the period, on stdout and nothing else.
 *
 * It is `sync`'s own reading — the same secret rule, the same reader, the same
 * messages — with nothing started and nothing sent, which is what makes it safe
 * to ask before a plist is written. An agent whose configuration this client
 * refuses would otherwise run every minute and log the same refusal every minute.
 */
export async function checkSync(deps: UseCaseDeps): Promise<number> {
  const { config } = await readSchedule(deps);
  deps.out(String(config.every));
  return EXIT_OK;
}

/**
 * The session and the schedule a run is about, read whole before anything is
 * started: one entry that could not work fails the run rather than being found
 * halfway through it, because a scheduled run has nobody to answer a question in
 * the middle of.
 */
async function readSchedule(deps: UseCaseDeps): Promise<Schedule> {
  const session = await openSession(deps.env, deps.files);
  const path = syncConfigPath(session.configDir);
  const file = await deps.files.readSecret(path, SYNC_CONFIG_FILE);
  if (file === undefined) {
    throw new UsageError(`no ${SYNC_CONFIG_FILE} in ${session.configDir}`);
  }
  const read = readSyncConfig(file.text);
  if (!read.ok) {
    throw new UsageError(read.errors.join("; "));
  }
  return { session, config: read.config };
}

/**
 * Where this run starts, and in what order it goes on.
 *
 * The index comes from the clock rather than from anything remembered, so two
 * ticks of the same schedule never start in the same place: a project that is
 * slow costs the ones after it this tick, and the next tick starts somewhere
 * else, which is fairness without state and without a run that has to know what
 * the last one did.
 */
function rotation(config: SyncConfig, now: number): readonly SyncProject[] {
  const { projects } = config;
  const start =
    Math.floor(Math.floor(now / SECOND_MS) / config.every) % projects.length;
  return [...projects.slice(start), ...projects.slice(0, start)];
}

function label(project: SyncProject): string {
  return `waves sync: ${project.project}`;
}

/**
 * The sleeper the writes of one project share, capped by the run's own budget.
 *
 * A write that is refused has one wait in it that nothing else bounds: the retry
 * policy honours a `Retry-After` for as long as the server asked, up to a minute,
 * up to three times, and a network or 5xx retry adds its own backoff. That is
 * right for a push someone is waiting for and wrong here, where one throttled
 * wave could spend three minutes of a sixty second tick and leave nothing for the
 * projects after it — a budget checked only between writes would not notice until
 * the next tick had already been missed.
 *
 * So a wait that would pass the deadline is not waited for at all: it ends that
 * write as this project's failure, the project reports itself out of time, and the
 * next project runs with whatever is left. The `Failure` is the one the entrypoint
 * would have made of a server that said no, because from here it is the same thing.
 */
function withinBudget(
  deps: UseCaseDeps,
  deadline: number,
): UseCaseDeps["sleeper"] {
  return {
    sleep: async (ms) => {
      if (deps.clock.now() + ms > deadline) {
        throw new Failure("out of time");
      }
      await deps.sleeper.sleep(ms);
    },
  };
}

/**
 * One project: its collector, its token, its waves and then its status.
 *
 * The token is read after the collector has exited, never before: a collector
 * that failed has said nothing worth pushing, and reading a credential for it
 * would be reading one for nothing. Every write for this project goes through one
 * paced transport, so its retries are paced too.
 *
 * Returns whether this project failed the run. The refusals that stop a project —
 * a token that cannot be read, a push the server refused — are the ones the
 * entrypoint would have turned into an exit code by hand: a usage error, a
 * failure and a file the adapter would not open are all one project's line, and
 * anything else is a bug in this package and travels out with its stack.
 */
async function runProject(
  session: Session,
  config: SyncConfig,
  project: SyncProject,
  deadline: number,
  deps: UseCaseDeps,
): Promise<boolean> {
  try {
    const collection = await collect(
      project,
      Math.min(project.timeoutSeconds * SECOND_MS, deadline - deps.clock.now()),
      deps,
    );
    if (!collection.ok) {
      deps.err(`${label(project)}: ${collection.reason}`);
      return true;
    }
    const { token } = await readTokenFor(session, deps.files, project.project);
    const transport = pacedTransport(transportFor(session, deps), deps);
    // The pace between two writes is this client's own and is never refused; the
    // waits *inside* a write are not, because a retry policy will sit on a
    // `Retry-After` for as long as the server asked and the run's budget is
    // smaller than that.
    const send = {
      ...deps,
      transport,
      sleeper: withinBudget(deps, deadline),
    };
    let sent = 0;
    let refused = false;
    for (const wave of collection.output.waves) {
      if (deps.clock.now() >= deadline) {
        deps.err(`${label(project)}: out of time after ${sent} waves`);
        return true;
      }
      try {
        await sendWave(
          {
            session,
            project: project.project,
            token,
            wave: wave.wave,
            lanes: wave.lanes,
            // The period is what every pushed wave says its own interval is, so
            // the contract's staleness is three ticks and no more.
            intervalSeconds: config.every,
            // Tails are what a push leaves out unless it is asked otherwise, and
            // nothing here has asked.
            includeTails: false,
          },
          send,
        );
        sent += 1;
      } catch (error) {
        // One wave the contract will not take is that wave's line: the collector
        // printed something it should not have, and the other waves are still
        // what the project knows. A push the server refused is not caught here —
        // that is this project's failure, and it ends the project.
        if (!(error instanceof UsageError)) {
          throw error;
        }
        refused = true;
        deps.err(`${label(project)}: ${wave.wave}: ${error.message}`);
      }
    }
    let statusSent = false;
    if (collection.output.status !== undefined) {
      if (deps.clock.now() >= deadline) {
        deps.err(`${label(project)}: out of time after ${sent} waves`);
        return true;
      }
      try {
        await sendProjectStatus(
          {
            session,
            project: project.project,
            token,
            input: collection.output.status,
            intervalSeconds: config.every,
          },
          send,
        );
        statusSent = true;
      } catch (error) {
        // A status the contract will not take is the status's own line, exactly as
        // an invalid wave is that wave's: the waves this tick were good and are
        // already stored, and the project's next tick is a whole tick away.
        if (!(error instanceof UsageError)) {
          throw error;
        }
        refused = true;
        deps.err(`${label(project)}: status: ${error.message}`);
      }
    }
    deps.out(`${label(project)}: ${sent} waves${statusSent ? ", status" : ""}`);
    return refused;
  } catch (error) {
    if (
      !(error instanceof UsageError) &&
      !(error instanceof Failure) &&
      !(error instanceof FileRefusal)
    ) {
      throw error;
    }
    deps.err(`${label(project)}: ${error.message}`);
    return true;
  }
}
