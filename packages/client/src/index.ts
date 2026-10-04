import { type CliIo, run } from "./application/entrypoint.js";
import type { CliDeps } from "./application/ports.js";
import { environment } from "./infrastructure/env.js";
import { fileSystem } from "./infrastructure/fs.js";
import { processRunner } from "./infrastructure/runner.js";
import { standardInput } from "./infrastructure/stdin.js";
import { systemClock, systemSleeper } from "./infrastructure/timers.js";
import { createTransport } from "./infrastructure/transport.js";

export { isValidId } from "./domain/id.js";
export { USAGE } from "./domain/args.js";
export { EXIT_FAILURE, EXIT_OK, EXIT_USAGE } from "./application/errors.js";
export type { CliIo } from "./application/entrypoint.js";
export type {
  CliDeps,
  Environment,
  Files,
  Transport,
  TransportFactory,
} from "./application/ports.js";

/**
 * Ports a caller may replace. Anything left out is built here from the real
 * process: the real environment, the real filesystem, real timers and Node's
 * own http client. The composition lives in this module and nowhere else, so
 * `main` is the single entry point of the package and `cli.ts` stays a shim.
 */
export type CliOverrides = Partial<CliDeps>;

export async function main(
  argv: readonly string[],
  io: CliIo,
  overrides: CliOverrides = {},
): Promise<number> {
  const files = overrides.files ?? fileSystem();
  const deps: CliDeps = {
    env: overrides.env ?? environment(),
    files,
    input: overrides.input ?? standardInput(),
    clock: overrides.clock ?? systemClock(),
    sleeper: overrides.sleeper ?? systemSleeper(),
    transport: overrides.transport ?? ((options) => createTransport(options)),
    runner: overrides.runner ?? processRunner(),
  };
  return await run(argv, io, deps);
}
