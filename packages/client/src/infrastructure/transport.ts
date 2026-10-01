import { request as httpRequest } from "node:http";
import type {
  ClientRequest,
  IncomingHttpHeaders,
  IncomingMessage,
} from "node:http";
import { type RequestOptions, request as httpsRequest } from "node:https";

import type {
  HttpRequest,
  Method,
  Transport,
  TransportOptions,
  TransportOutcome,
} from "../application/ports.js";

/** One request, one answer: long enough for a proxy, short enough to notice a hang. */
export const REQUEST_TIMEOUT_MS = 10_000;

/** An answer bigger than this is a sign the peer is not the server we asked for. */
export const MAX_BODY_BYTES = 65_536;

export const JSON_TYPE = "application/json";

const BEARER = "Bearer ";
const BRACKETS = /^\[|\]$/g;

type Starter = (
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
) => ClientRequest;

/**
 * The options of one request. Two of them are the point of this whole module:
 * every https request carries `rejectUnauthorized: true` and there is no code
 * path anywhere that turns it off, and no `Origin` is ever sent, so a request
 * from a project is indistinguishable from any other server-to-server request.
 */
export function buildOptions(
  url: URL,
  method: Method,
  bearer: string,
  body: string | undefined,
  ca: string | undefined,
): RequestOptions {
  const headers: Record<string, string> = {
    accept: JSON_TYPE,
    authorization: `${BEARER}${bearer}`,
  };
  if (body !== undefined) {
    headers["content-type"] = JSON_TYPE;
    headers["content-length"] = String(Buffer.byteLength(body));
  }
  return {
    protocol: url.protocol,
    method,
    hostname: url.hostname.replace(BRACKETS, ""),
    port: url.port === "" ? undefined : Number(url.port),
    path: `${url.pathname}${url.search}`,
    headers,
    agent: false,
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
 * The transport of one run. The starter is injectable so the exchange can be
 * tested against a scripted peer, but the default is Node's own client and
 * nothing in between.
 */
export function createTransport(
  options: TransportOptions,
  start: Starter = starterFor(options.origin),
): Transport {
  return {
    send: (request) => send(options, start, request),
  };
}

async function send(
  options: TransportOptions,
  start: Starter,
  request: HttpRequest,
): Promise<TransportOutcome> {
  const url = new URL(request.url);
  if (url.protocol === "http:") {
    options.warnInsecure?.();
  }
  const requestOptions = buildOptions(
    url,
    request.method,
    request.bearer,
    request.body,
    options.ca,
  );
  return await exchange(start, requestOptions, request.body);
}

function exchange(
  start: Starter,
  options: RequestOptions,
  body: string | undefined,
): Promise<TransportOutcome> {
  return new Promise((resolve) => {
    let answered = false;
    const finish = (outcome: TransportOutcome): void => {
      if (!answered) {
        answered = true;
        resolve(outcome);
      }
    };
    let request: ClientRequest;
    try {
      request = start(options, (response) => {
        readResponse(response, finish);
      });
    } catch (error) {
      finish({ kind: "network", message: messageOf(error) });
      return;
    }
    request.on("error", (error: unknown) => {
      finish({ kind: "network", message: messageOf(error) });
    });
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy();
      finish({
        kind: "network",
        message: `no answer within ${REQUEST_TIMEOUT_MS} ms`,
      });
    });
    request.end(body);
  });
}

function readResponse(
  response: IncomingMessage,
  finish: (outcome: TransportOutcome) => void,
): void {
  const chunks: Buffer[] = [];
  let size = 0;
  let refused = false;
  response.on("data", (chunk: Buffer) => {
    if (refused) {
      return;
    }
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      refused = true;
      response.destroy();
      finish({
        kind: "network",
        message: `the answer is larger than ${MAX_BODY_BYTES} bytes`,
      });
      return;
    }
    chunks.push(chunk);
  });
  response.on("end", () => {
    finish({
      kind: "reply",
      reply: {
        status: response.statusCode ?? 0,
        headers: headerText(response.headers),
        body: Buffer.concat(chunks).toString("utf8"),
      },
    });
  });
  response.on("error", (error: unknown) => {
    finish({ kind: "network", message: messageOf(error) });
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
