import { afterEach, expect } from "vitest";

import {
  SECRET_SHAPE,
  forgetPrinted,
  knownSecrets,
  printedLines,
} from "./harness.js";

/**
 * The check that no test has to remember: after every test in the client
 * project, every line this suite printed is searched for every secret the suite
 * knows about, and for the shape they all share. A token that reaches stdout,
 * stderr or a failure message fails the test that printed it, wherever that is.
 */
afterEach(() => {
  const lines = printedLines();
  const secrets = knownSecrets();
  forgetPrinted();
  for (const line of lines) {
    for (const secret of secrets) {
      expect(
        line.includes(secret),
        `a secret reached the output: ${line}`,
      ).toBe(false);
    }
    expect(
      SECRET_SHAPE.test(line),
      `a secret reached the output: ${line}`,
    ).toBe(false);
  }
});
