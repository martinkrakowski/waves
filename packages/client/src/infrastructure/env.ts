import { homedir } from "node:os";

import type { Environment } from "../application/ports.js";

/**
 * `process.env` and the home directory. An explicit source makes the adapter
 * testable without touching the environment of the test runner.
 */
export function environment(
  source: NodeJS.ProcessEnv = process.env,
): Environment {
  return {
    get: (name) => source[name],
    home: () => homedir(),
  };
}
