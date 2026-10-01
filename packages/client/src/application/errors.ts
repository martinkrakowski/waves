export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;

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
