import type { IncomingMessage } from "node:http";

/**
 * The address the failure limiter keys on. With a trusted proxy in front, it is
 * the last entry of `X-Forwarded-For`, which such a proxy appends the client to
 * and which a client cannot therefore forge; the first entries are whatever the
 * chain before it claimed and are dropped. Without one it is the socket, and
 * every forwarding header is ignored, because an untrusted client can write any
 * value it likes into one.
 */
export function forwardedAddress(
  header: string | undefined,
  fallback: string,
): string {
  if (header === undefined) {
    return fallback;
  }
  const entries = header
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  return entries[entries.length - 1] ?? fallback;
}

export function socketAddress(socket: {
  readonly remoteAddress?: string;
}): string {
  return socket.remoteAddress ?? "";
}

/**
 * The scheme the client used, as a trusted proxy reported it. Anything other
 * than `https` is refused on a write route; the comparison is on a trimmed and
 * lower-cased copy, and an absent header is `undefined` rather than `http`, so
 * a proxy that does not report a scheme cannot be read as reporting a safe one.
 * Two values are joined, which no single scheme can equal.
 */
export function forwardedProto(req: IncomingMessage): string | undefined {
  const values = req.headersDistinct["x-forwarded-proto"];
  return values === undefined
    ? undefined
    : values.join(",").trim().toLowerCase();
}

/** Every value the client sent for a header, joined the way Node joins them. */
export function headerValues(
  req: IncomingMessage,
  name: string,
): string | undefined {
  const values = req.headersDistinct[name];
  return values === undefined ? undefined : values.join(", ");
}

export function clientAddress(
  req: IncomingMessage,
  trustProxy: boolean,
): string {
  const socket = socketAddress(req.socket);
  if (!trustProxy) {
    return socket;
  }
  return forwardedAddress(headerValues(req, "x-forwarded-for"), socket);
}
