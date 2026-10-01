import type { Clock, Sleeper } from "../application/ports.js";

export function systemClock(): Clock {
  return { now: () => Date.now() };
}

export function systemSleeper(): Sleeper {
  return {
    sleep: (ms) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }),
  };
}
