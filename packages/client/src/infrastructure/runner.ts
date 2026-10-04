import { spawn } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import { finished } from "node:stream";
import type { Readable } from "node:stream";

import type { RunOutcome, RunRequest, Runner } from "../application/ports.js";

/** A collector that printed more stdout than this is not one this client can read. */
export const MAX_STDOUT_BYTES = 4 * 1024 * 1024;

/** stderr is a note for a log, so it is kept to the size of a paragraph. */
export const MAX_STDERR_BYTES = 64 * 1024;

/**
 * How long the pipes may take to drain once the child is gone. A grandchild that
 * inherited stdout is killed with the group, so this is only the wait for a
 * process that was already on its way out — and the cap is what keeps a pipe
 * somebody else is holding from keeping this client's event loop alive.
 */
export const DRAIN_CAP_MS = 1000;

/** The seams a test replaces, and nothing else: the real ones are the defaults. */
export interface RunnerOptions {
  /** Sends `SIGKILL` to a process group. A test can make it do nothing at all. */
  readonly kill?: (pid: number) => void;
}

function killGroupOf(pid: number): void {
  process.kill(-pid, "SIGKILL");
}

/**
 * Runs one program and answers with how it ended.
 *
 * The child is spawned with no shell and in a process group of its own, and
 * every signal this sends is addressed to that group rather than to the child:
 * a collector that leaves a grandchild behind would otherwise keep the pipes
 * open, and a pipe nobody can close is a run that never finishes under a
 * scheduler with no terminal to hang up on. The group kill is best effort and
 * happens after *every* exit, so a child that outlives its own work by leaving
 * something behind does not leave it behind for the next tick.
 */
export function processRunner(options: RunnerOptions = {}): Runner {
  const killGroup = options.kill ?? killGroupOf;
  return { run: (request) => runOnce(request, killGroup) };
}

async function runOnce(
  request: RunRequest,
  kill: (pid: number) => void,
): Promise<RunOutcome> {
  const [program, ...args] = request.command;
  if (program === undefined || program === "") {
    // Node answers an empty program by throwing before it returns a handle, so
    // this is the one failure of a spawn with nothing to kill.
    return { kind: "spawn-error", message: "no program to run" };
  }
  const maxStdout = request.maxStdout ?? MAX_STDOUT_BYTES;
  const maxStderr = request.maxStderr ?? MAX_STDERR_BYTES;
  let child: ChildProcessByStdio<null, Readable, Readable>;
  try {
    child = spawn(program, args, {
      cwd: request.cwd,
      env: { ...request.env },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    // Everything the kernel refuses with a code Node turns into an `error` event
    // arrives below; anything else it throws before it returns a handle — a `cwd`
    // naming a file is ENOTDIR. That is still a collector that could not be
    // started, and it is that project's failure rather than the end of the run.
    return { kind: "spawn-error", message: messageOf(error) };
  }

  return await new Promise<RunOutcome>((resolve) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const pipes = [child.stdout, child.stderr];
    let outBytes = 0;
    let errKept = 0;
    let stderrTruncated = false;
    let overflowed = false;
    let timedOut = false;
    /** Armed only when a kill was sent and `exit` may never come. */
    let giveUp: NodeJS.Timeout | undefined;

    const destroyPipes = (): void => {
      for (const pipe of pipes) {
        pipe.destroy();
      }
    };

    /**
     * The whole group, and never the child alone. A program that never started has
     * no pid and so no group to address, which is the only case in which this
     * does nothing. ESRCH is the state it asks for, the group being already gone,
     * and any other answer is left alone rather than thrown from a timer.
     */
    const killGroup = (): void => {
      if (child.pid !== undefined) {
        try {
          kill(child.pid);
        } catch {
          // Nothing here can be done about it, and a group that survived it is
          // the one thing a caller cannot be told about from a signal handler.
        }
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
      // A signal that cannot be delivered — EPERM, or a child in uninterruptible
      // I/O — means `exit` may never arrive, and a scheduled run that waits for
      // it is a run that never ends and never fires again. So the wait is capped
      // from here too: the pipes go, the child is unreferenced so it cannot hold
      // this process open, and the answer is a timeout whether or not the kernel
      // got round to it.
      giveUp = setTimeout(() => {
        destroyPipes();
        child.unref();
        settle({ kind: "timeout" });
      }, DRAIN_CAP_MS);
    }, request.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > maxStdout) {
        // Past the cap the output is not a collection any more, so the group is
        // killed rather than read: a collector printing without end is the one
        // failure this client will not wait out.
        overflowed = true;
        killGroup();
        return;
      }
      stdout.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const room = maxStderr - errKept;
      if (room <= 0) {
        // Read and thrown away, never paused: a pipe nobody is draining is a
        // collector blocked on a write, and the timeout would then be reporting
        // a full pipe as if it were a slow collector.
        stderrTruncated = true;
        return;
      }
      // What fits is kept, so the note is the cap itself rather than whatever the
      // last read happened to end on.
      const kept = chunk.length <= room ? chunk : chunk.subarray(0, room);
      errKept += kept.length;
      stderr.push(kept);
      if (kept.length < chunk.length) {
        stderrTruncated = true;
      }
    });

    /**
     * The one answer this run gives. A promise keeps the first answer it is
     * given, so a late `error`, `exit` or give-up after another changes nothing;
     * what every answer has to do is stop both timers, because a timer left armed
     * is an event loop kept alive for the rest of its budget.
     */
    const settle = (outcome: RunOutcome): void => {
      clearTimeout(timer);
      if (giveUp !== undefined) {
        clearTimeout(giveUp);
        giveUp = undefined;
      }
      resolve(outcome);
    };

    // A program that could not be started at all: no pid, no exit, and nothing
    // of the kernel's message beyond the text it gives. An error is an answer this
    // run is giving up on the program for, so whatever it left behind goes with it.
    child.on("error", (error: Error) => {
      killGroup();
      settle({ kind: "spawn-error", message: error.message });
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      killGroup();
      void drain(pipes, destroyPipes).then(() => {
        if (timedOut) {
          settle({ kind: "timeout" });
          return;
        }
        if (overflowed) {
          settle({ kind: "overflow" });
          return;
        }
        settle({
          kind: "exit",
          code,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
          stderrTruncated,
        });
      });
    });
  });
}

/**
 * Waits for the pipes to be done, then gives up on them.
 *
 * `finished` answers for a stream that has already ended as well as for one that
 * is still going, so the count is the same either way: every pipe, plus one for
 * the loop that registered them. Nothing is waited for longer than the cap, and
 * both pipes are destroyed when the cap passes, which is what stops a collector
 * somebody else's process is holding open from outliving the run.
 */
function drain(pipes: readonly Readable[], destroy: () => void): Promise<void> {
  return new Promise<void>((ready) => {
    let left = pipes.length + 1;
    const cap = setTimeout(() => {
      destroy();
      ready();
    }, DRAIN_CAP_MS);
    const tick = (): void => {
      left -= 1;
      if (left > 0) {
        return;
      }
      clearTimeout(cap);
      ready();
    };
    for (const pipe of pipes) {
      finished(pipe, tick);
    }
    tick();
  });
}

/**
 * What a spawn that threw had to say. Everything Node throws here is one of its
 * own errors — a `cwd` that is not a directory, a program that is not a string, an
 * argument of the wrong type — and their message is the code and the reason the
 * kernel gave. A token crossed no socket to reach here, so there is nothing in it
 * to keep out of a log.
 */
function messageOf(error: unknown): string {
  return (error as Error).message;
}
