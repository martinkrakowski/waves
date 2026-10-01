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
   */
  readSecret(path: string): Promise<FileRead | undefined>;
  exists(path: string): Promise<boolean>;
  /** Writes a secret so that no window exists in which it is loose on disk. */
  writeSecret(path: string, secret: string): Promise<void>;
}

export interface InputStream {
  read(): Promise<string>;
}

export type Method = "POST" | "PUT" | "DELETE";

export interface HttpRequest {
  readonly method: Method;
  readonly url: string;
  readonly bearer: string;
  readonly body?: string;
}

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

export interface TransportOptions {
  readonly origin: string;
  /** The PEM of a private certificate authority, when one was configured. */
  readonly ca?: string;
  /** Called before every request when the host was allowed to be plain http. */
  warnInsecure?: () => void;
}

export type TransportFactory = (options: TransportOptions) => Transport;

export interface CliDeps {
  readonly env: Environment;
  readonly files: Files;
  readonly input: InputStream;
  readonly clock: Clock;
  readonly sleeper: Sleeper;
  readonly transport: TransportFactory;
}

/** The ports plus the two streams the use cases report on. */
export interface UseCaseDeps extends CliDeps {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}
