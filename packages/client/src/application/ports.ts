/**
 * Every port the application layer reaches the outside world through. Nothing
 * here is an adapter: each interface is a question the use cases ask, and each
 * adapter under `src/infrastructure/` is one way of answering it.
 */

/** The process environment, plus the one path the client needs from the system. */
export interface Environment {
  get(name: string): string | undefined;
  home(): string;
}

export interface Clock {
  now(): number;
}

export interface Sleeper {
  sleep(ms: number): Promise<void>;
}

/**
 * A file the client will not read or write, with the reason already phrased for
 * the user: a link where a file was expected, a directory someone else can
 * reach, a mode that is too loose, or an error the kernel named. The entrypoint
 * turns one of these into exit 2, because every one of them is something the
 * user can fix with `chmod`, `mv` or a path.
 */
export class FileRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileRefusal";
  }
}

export interface FileRead {
  readonly text: string;
  /** The permission bits `fstat` reported on the open descriptor. */
  readonly mode: number;
}

export interface Files {
  /** The contents of a file the project gave us, or `undefined` if it is not there. */
  readText(path: string): Promise<string | undefined>;
  /**
   * A file holding a secret. It is opened without following a link and checked
   * before a byte is read, so `readSecret` throws a `FileRefusal` rather than
   * returning the contents of whatever a link pointed at.
   *
   * `name` is how this file is called in a refusal that has to name it — a
   * `sync.json` is held to the same rule as a token, and saying "the token file"
   * about it would send the owner looking in the wrong place. The check itself is
   * the same either way.
   */
  readSecret(path: string, name?: string): Promise<FileRead | undefined>;
  /**
   * The rules the directory the tokens live in must satisfy: not a link, not
   * owned by somebody else, and reachable only by its owner. Asked before an
   * admin token is spent, so a directory that cannot hold a secret safely is
   * never discovered after a token has been minted. A directory that is not
   * there yet is nothing to check — this client will create it itself.
   */
  checkSecretDirectory(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Writes a secret so that no window exists in which it is loose on disk. */
  writeSecret(path: string, secret: string): Promise<void>;
}

/**
 * What the reader found at the pin path. A file that is not there is `missing`,
 * and everything else is `present` with what the descriptor said about it: the
 * kind of thing it is, the uid that owns it and the permission bits, plus its
 * text when it is a regular file that could be read. A link is never followed,
 * so its `text` is `undefined` and its `type` says what it is.
 */
export type PinRead =
  | { readonly kind: "missing" }
  | {
      readonly kind: "present";
      readonly type: "file" | "symlink" | "other";
      readonly uid: number;
      readonly mode: number;
      readonly text: string | undefined;
    };

/**
 * The owner's pinned public keys, read from a path this port's adapter owns: a
 * session can point nothing at the file it would like the reader to trust. The
 * checks on what was found — root-owned, not group- or world-writable, a valid
 * owner-keys document — belong to the use case, so a fake port can exercise
 * every one of them.
 */
export interface OwnerPins {
  read(): Promise<PinRead>;
}

/**
 * The two cryptographic answers the signed-answer checks need, as a port so the
 * use cases stay pure and an adapter can hand over `node:crypto`'s. A private
 * key never reaches this interface: only a digest and the verdict on somebody
 * else's signature.
 */
export interface Crypto {
  /** The SHA-256 digest of the bytes: the hashes the checks recompute. */
  sha256(data: Uint8Array): Uint8Array;
  /**
   * ES256 — ECDSA over P-256 with a SHA-256 digest — of the message against a
   * public key in SPKI DER form. `ok` says the signature is the key's own;
   * `bad-signature` says it is not, or that nothing could be read of the key
   * or the signature at all; `not-p256` says the key is a different curve's or
   * a different family's, which is a fact about the pin rather than about the
   * signature, and gets its own answer so it can get its own sentence.
   */
  verifyEs256(
    spki: Uint8Array,
    message: Uint8Array,
    derSignature: Uint8Array,
  ): "ok" | "bad-signature" | "not-p256";
}

export interface InputStream {
  read(): Promise<string>;
}

export type Method = "GET" | "POST" | "PUT" | "DELETE";

/** A read carries no token: the route is public. */
export interface HttpGet {
  readonly method: "GET";
  readonly url: string;
  readonly body?: string;
}

/** A write carries the project's token, and every write is one. */
export interface HttpMutation {
  readonly method: Exclude<Method, "GET">;
  readonly url: string;
  readonly bearer: string;
  readonly body?: string;
}

/**
 * A request is either a read with no token, or a write with one: a PUT, POST or
 * DELETE that carries the bearer the project earned. The split is structural and
 * checked at the call site, so a write built without a token no longer compiles.
 */
export type HttpRequest = HttpGet | HttpMutation;

export interface HttpReply {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/**
 * An attempt either produced a reply or produced nothing at all. The difference
 * decides whether it is worth repeating, so it is part of the answer rather
 * than an exception: a message that crossed a socket can never carry a token,
 * and the retry policy gets to see it.
 *
 * `beforeBody` says the request body was never written. That is the difference
 * between a POST that could not have minted anything and one whose token the
 * server may have issued into a socket that then died.
 */
export type TransportOutcome =
  | { readonly kind: "reply"; readonly reply: HttpReply }
  | {
      readonly kind: "network";
      readonly message: string;
      readonly beforeBody: boolean;
    };

export interface Transport {
  send(request: HttpRequest): Promise<TransportOutcome>;
}

/**
 * One program the client runs: a project's own collector. The command is the
 * program and its arguments as an array, because it is spawned without a shell —
 * there is no quoting to get right and nothing in a command line is expanded.
 */
export interface RunRequest {
  readonly command: readonly string[];
  readonly cwd: string;
  /** The collector's whole environment, and nothing of this client's own. */
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly maxStdout?: number;
  readonly maxStderr?: number;
}

/**
 * How a program ended. Only an `exit` with a code of 0 is a collection; every
 * other answer is that project's failure and nothing it printed is used.
 *
 * `exit` carries the streams as they were kept: stdout whole, stderr cut at its
 * cap with `stderrTruncated` saying so, because a note in a log is worth a line
 * and not a megabyte. A program killed by a signal has no code, which is why
 * `code` is `number | null`.
 */
export type RunOutcome =
  | {
      readonly kind: "exit";
      readonly code: number | null;
      readonly stdout: string;
      readonly stderr: string;
      readonly stderrTruncated: boolean;
    }
  | { readonly kind: "timeout" }
  | { readonly kind: "overflow" }
  | { readonly kind: "spawn-error"; readonly message: string };

export interface Runner {
  run(request: RunRequest): Promise<RunOutcome>;
}

export interface TransportOptions {
  readonly origin: string;
  /** The PEM of a private certificate authority, when one was configured. */
  readonly ca?: string;
  /**
   * Called before every request when the host was allowed to be plain http. The
   * request is handed in so the wording can tell a read — which carries no token —
   * from a write, which does.
   */
  warnInsecure?: (request: HttpRequest) => void;
}

export type TransportFactory = (options: TransportOptions) => Transport;

export interface CliDeps {
  readonly env: Environment;
  readonly files: Files;
  readonly input: InputStream;
  readonly clock: Clock;
  readonly sleeper: Sleeper;
  readonly transport: TransportFactory;
  readonly runner: Runner;
  readonly ownerPins: OwnerPins;
  readonly crypto: Crypto;
}

/** The ports plus the two streams the use cases report on. */
export interface UseCaseDeps extends CliDeps {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}
