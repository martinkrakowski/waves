import { request as httpRequest } from "node:http";
import type {
  ClientRequest,
  IncomingHttpHeaders,
  IncomingMessage,
} from "node:http";
import { type RequestOptions, request as httpsRequest } from "node:https";

import type {
  HttpRequest,
  Transport,
  TransportOptions,
  TransportOutcome,
} from "../application/ports.js";

/**
 * The whole wall clock a request may take, body included. A timer on the socket
 * would only notice that nothing arrived; a server that drips one byte a second
 * would keep a push open for as long as it liked.
 */
export const REQUEST_TIMEOUT_MS = 10_000;

/**
 * How long to wait for the server to say `100 Continue` before writing the body
 * anyway. A server that ignores `Expect` should not cost a snapshot.
 */
export const CONTINUE_WAIT_MS = 1000;

/** An answer bigger than this is a sign the peer is not the server we asked for. */
export const MAX_BODY_BYTES = 65_536;

export const JSON_TYPE = "application/json";

const BEARER = "Bearer ";
const BRACKETS = /^\[|\]$/g;
const FIRST_REFUSAL = 400;
const LAST_REFUSAL = 499;

type Starter = (
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
) => ClientRequest;

/** One deadline per request, so every exchange gets a fresh clock. */
type Deadline = () => AbortSignal;

/**
 * The options of one request. Three of them are the point of this whole module:
 * every https request carries `rejectUnauthorized: true` and there is no code
 * path anywhere that turns it off, `signal` bounds the request in wall-clock
 * time, and no `Origin` is ever sent, so a request from a project is
 * indistinguishable from any other server-to-server request.
 */
export function buildOptions(
  url: URL,
  method: string,
  bearer: string | undefined,
  body: string | undefined,
  ca: string | undefined,
  deadline: AbortSignal,
): RequestOptions {
  const headers: Record<string, string> = {
    accept: JSON_TYPE,
  };
  if (bearer !== undefined) {
    headers["authorization"] = `${BEARER}${bearer}`;
  }
  if (body !== undefined) {
    headers["content-type"] = JSON_TYPE;
    headers["content-length"] = String(Buffer.byteLength(body));
    // A snapshot is not worth writing if the server is going to refuse the
    // headers anyway, which is what asking first is for.
    headers["expect"] = "100-continue";
  }
  return {
    protocol: url.protocol,
    method,
    hostname: url.hostname.replace(BRACKETS, ""),
    port: url.port === "" ? undefined : Number(url.port),
    path: `${url.pathname}${url.search}`,
    headers,
    agent: false,
    signal: deadline,
    ...(url.protocol === "https:" ? { rejectUnauthorized: true } : {}),
    ...(ca === undefined ? {} : { ca }),
  };
}

/** Node's own request function for the protocol of the origin. */
function starterFor(origin: string): Starter {
  const url = new URL(origin);
  if (url.protocol === "https:") {
    return (options, callback) => httpsRequest(options, callback);
  }
  return (options, callback) => httpRequest(options, callback);
}

/**
 * The transport of one run. The starter and the deadline are injectable so the
 * exchange can be tested against a scripted peer, but the defaults are Node's
 * own client and Node's own clock.
 */
export function createTransport(
  options: TransportOptions,
  start: Starter = starterFor(options.origin),
  deadline: Deadline = () => AbortSignal.timeout(REQUEST_TIMEOUT_MS),
): Transport {
  return {
    send: (request) => send(options, start, deadline, request),
  };
}

async function send(
  options: TransportOptions,
  start: Starter,
  deadline: Deadline,
  request: HttpRequest,
): Promise<TransportOutcome> {
  const url = new URL(request.url);
  if (url.protocol === "http:") {
    options.warnInsecure?.();
  }
  const signal = deadline();
  const requestOptions = buildOptions(
    url,
    request.method,
    request.bearer,
    request.body,
    options.ca,
    signal,
  );
  return await exchange(start, requestOptions, request.body, signal);
}

/**
 * One request, one answer, written around three facts about a socket:
 *
 * - a status that has arrived is a verdict, whatever happens to the connection
 *   afterwards, so a 401 whose body is cut short is still a 401 and is never
 *   retried;
 * - a body that has not been written cannot have been acted on, which is what
 *   makes a POST worth repeating;
 * - `Expect: 100-continue` means the server has the headers before it has the
 *   snapshot, so a refusal on the headers alone costs nothing to send.
 */
function exchange(
  start: Starter,
  options: RequestOptions,
  body: string | undefined,
  signal: AbortSignal,
): Promise<TransportOutcome> {
  return new Promise((resolve) => {
    let answered = false;
    let status: number | undefined;
    let headers: Record<string, string> = {};
    let wroteBody = false;
    let waiting: NodeJS.Timeout | undefined;
    const chunks: Buffer[] = [];
    let size = 0;

    const stopWaiting = (): void => {
      if (waiting !== undefined) {
        clearTimeout(waiting);
        waiting = undefined;
      }
    };
    const finish = (outcome: TransportOutcome): void => {
      if (answered) {
        return;
      }
      answered = true;
      stopWaiting();
      resolve(outcome);
    };
    const asReply = (): TransportOutcome => ({
      kind: "reply",
      reply: {
        status: status ?? 0,
        headers,
        body: Buffer.concat(chunks).toString("utf8"),
      },
    });
    const isRefusal = (): boolean =>
      status !== undefined && status >= FIRST_REFUSAL && status <= LAST_REFUSAL;
    /**
     * The connection is gone. If the server had already refused, that refusal is
     * the answer and the cut body is just a truncated explanation of it. Only
     * `finish` decides whether anything still counts as the outcome, so a late
     * event after the answer is dropped in one place.
     */
    const lost = (message: string, tidy: () => void): void => {
      tidy();
      if (isRefusal()) {
        finish(asReply());
        return;
      }
      finish({ kind: "network", message, beforeBody: !wroteBody });
    };
    const sendBody = (): void => {
      if (wroteBody || answered) {
        return;
      }
      wroteBody = true;
      request.end(body);
    };

    let request: ClientRequest;
    const onResponse = (response: IncomingMessage): void => {
      status = response.statusCode;
      // The headers are read the moment they arrive, not when the body ends: a
      // connection that dies mid-body still leaves a Retry-After and a challenge
      // the client needs to act on.
      headers = headerText(response.headers);
      stopWaiting();
      // A response that arrived before the body means the server never wanted
      // it: read the refusal out and drop the connection rather than earn a
      // reset by writing a snapshot into a closed socket.
      const tidy = (): void => {
        if (!wroteBody && body !== undefined) {
          request.destroy();
        }
      };
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          lost(`the answer is larger than ${MAX_BODY_BYTES} bytes`, () => {
            response.destroy();
          });
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        tidy();
        finish(asReply());
      });
      response.on("error", (error: unknown) => {
        lost(messageOf(error), tidy);
      });
    };

    try {
      request = start(options, onResponse);
    } catch (error) {
      finish({ kind: "network", message: messageOf(error), beforeBody: true });
      return;
    }

    request.on("error", (error: unknown) => {
      lost(messageOf(error), () => undefined);
    });
    request.on("continue", () => {
      stopWaiting();
      sendBody();
    });
    signal.addEventListener("abort", () => {
      request.destroy();
      lost(`no answer within ${REQUEST_TIMEOUT_MS} ms`, () => undefined);
    });

    if (body === undefined) {
      request.end();
      return;
    }
    request.flushHeaders();
    // A server that never answers the expectation still gets the snapshot.
    waiting = setTimeout(() => {
      waiting = undefined;
      sendBody();
    }, CONTINUE_WAIT_MS);
  });
}

function headerText(headers: IncomingHttpHeaders): Record<string, string> {
  const text: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    text[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return text;
}

/**
 * What a socket said about itself. Node's own messages carry a code and a
 * reason; a token crossed the socket as a header and is in none of them.
 */
function messageOf(error: unknown): string {
  const message = (error as { readonly message?: unknown }).message;
  return typeof message === "string" ? message : String(error);
}
