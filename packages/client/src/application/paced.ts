import type { Transport, UseCaseDeps } from "./ports.js";

/** The two ports a pace is measured with: the clock, and the sleeper it waits on. */
type WaitDeps = Pick<UseCaseDeps, "clock" | "sleeper">;

/**
 * How far apart two writes are sent. The server gives a project one write a
 * second, shared by its waves and its status, and a run that ignored that would
 * be throttled by a server that had done nothing wrong.
 */
export const SYNC_SPACING_MS = 1000;

/**
 * A transport that waits until a second has passed since the last request sent
 * through it before it sends the next one.
 *
 * It wraps the transport rather than sitting inside the retry loop, which is the
 * whole point: a `Retry-After: 0` and an HTTP-date that has already passed both
 * mean "now", and a loop that sleeps between its own attempts would put two
 * requests inside one second exactly when the server asked for one. Waiting here
 * means every attempt is paced, including the ones nobody planned.
 *
 * One of these is built per project rather than per run, so the pacing is
 * between one project's own writes: two projects are two rate limits, and making
 * the second wait for the first would spend a tick doing nothing.
 */
export function pacedTransport(inner: Transport, deps: WaitDeps): Transport {
  let last: number | undefined;
  return {
    send: async (request) => {
      if (last !== undefined) {
        const waited = last + SYNC_SPACING_MS - deps.clock.now();
        if (waited > 0) {
          await deps.sleeper.sleep(waited);
        }
      }
      // Read again after the wait: the gap is between two sends, not between two
      // requests for a send, so a slow first attempt is not waited for twice.
      last = deps.clock.now();
      return await inner.send(request);
    },
  };
}
