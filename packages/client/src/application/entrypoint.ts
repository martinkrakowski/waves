import { COMMAND_NAME, USAGE, parseArgv } from "../domain/args.js";
import { remove } from "./delete.js";
import {
  EXIT_FAILURE,
  EXIT_OK,
  EXIT_USAGE,
  Failure,
  UsageError,
} from "./errors.js";
import { FileRefusal, type CliDeps, type UseCaseDeps } from "./ports.js";
import { push } from "./push.js";
import { register } from "./register.js";
import { registerAll } from "./register-all.js";
import { sendStatus } from "./status.js";

export interface CliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/**
 * The whole CLI, with every port handed in. It parses, dispatches and turns a
 * refusal into an exit code: 0 for a run that did what it was asked, 2 for a
 * command line, a configuration or a file that cannot work, and 1 for a server
 * or a network that said no.
 *
 * Nothing else is caught. An error that is none of those three is a bug in this
 * package, and it travels out to the shell shim rather than being dressed up as
 * an answer the user has to interpret.
 */
export async function run(
  argv: readonly string[],
  io: CliIo,
  deps: CliDeps,
): Promise<number> {
  const parsed = parseArgv(argv);
  if (!parsed.ok) {
    io.err(`waves: ${parsed.error}`);
    io.err(USAGE);
    return EXIT_USAGE;
  }
  if (parsed.command.kind === "help") {
    io.out(USAGE);
    return EXIT_OK;
  }
  const label = COMMAND_NAME[parsed.command.kind];
  const useCase: UseCaseDeps = { ...deps, out: io.out, err: io.err };
  try {
    if (parsed.command.kind === "register") {
      return await register(parsed.command, useCase);
    }
    if (parsed.command.kind === "register-all") {
      return await registerAll(parsed.command, useCase);
    }
    if (parsed.command.kind === "push") {
      return await push(parsed.command, useCase);
    }
    if (parsed.command.kind === "status") {
      return await sendStatus(parsed.command, useCase);
    }
    return await remove(parsed.command, useCase);
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`${label}: ${error.message}`);
      return EXIT_USAGE;
    }
    if (error instanceof Failure) {
      io.err(`${label}: ${error.message}`);
      return EXIT_FAILURE;
    }
    if (error instanceof FileRefusal) {
      io.err(`${label}: ${error.message}`);
      return EXIT_USAGE;
    }
    throw error;
  }
}
