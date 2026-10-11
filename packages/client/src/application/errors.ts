export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;
/**
 * A `409` on a state write: the pin is stale, the entry the writer read has moved
 * on, and the writer must read the decision again before writing again.
 */
export const EXIT_STALE = 5;
/**
 * A `read --signed` found a signed answer on the current text, and one of its
 * checks — or one on the pin file itself — refused it. Nothing about the
 * answer may be acted on.
 */
export const EXIT_UNVERIFIED = 3;
/**
 * A `read --signed` that found no signed answer on the current text: there is
 * nothing to verify, and nothing on this text for a session to act on.
 */
export const EXIT_UNSIGNED = 4;

/**
 * The command line or the configuration is wrong: nothing was sent, and
 * changing an argument or a variable is what makes it work. Exit 2.
 */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/**
 * The server or the network refused: the request was well formed and the answer
 * was no. Exit 1.
 */
export class Failure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Failure";
  }
}
