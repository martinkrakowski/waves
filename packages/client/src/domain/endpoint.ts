import { isLaneId, isProjectId } from "@hexagen-monaco/waves-contract";

import { isValidId } from "./id.js";

export const API_PREFIX = "/api/v1/projects";

const LOOPBACK_NAME = "localhost";
const LOOPBACK_IPV6 = "::1";
const LOOPBACK_IPV4_PREFIX = "127";
const IPV6_CHARS = /^[0-9a-fA-F:.]+$/;
const IPV4_OCTET = /^\d{1,3}$/;
const IPV4_PARTS = 4;

/**
 * Where the server is, and how the client is allowed to talk to it.
 *
 * `warnInsecure` is set only for a plain `http:` host that is neither loopback
 * nor unreachable — that is, a host the operator opened with
 * `WAVES_ALLOW_INSECURE_HTTP=1`. Every request to it is announced.
 */
export interface Endpoint {
  readonly origin: string;
  readonly secure: boolean;
  readonly warnInsecure: boolean;
}

export type EndpointResult =
  | { readonly ok: true; readonly endpoint: Endpoint }
  | { readonly ok: false; readonly error: string };

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/** A bracketed IPv6 literal, which `URL` hands back with its brackets. */
function isIpv6Literal(host: string): boolean {
  return host.includes(":") && IPV6_CHARS.test(host);
}

/**
 * A host the client will send a token to. Names are dot-separated slugs, which
 * is also what rules out an underscore, a space and anything else that could
 * only have come from a typo. URL already normalises a numeric host, so an
 * IPv4 literal arrives as four decimal octets.
 */
export function isHostName(host: string): boolean {
  if (host.startsWith("[")) {
    return isIpv6Literal(stripBrackets(host));
  }
  return host.split(".").every((label) => isValidId(label));
}

function isLoopbackIpv4(host: string): boolean {
  const parts = host.split(".");
  return (
    parts.length === IPV4_PARTS &&
    parts[0] === LOOPBACK_IPV4_PREFIX &&
    parts.every((part) => IPV4_OCTET.test(part) && Number(part) <= 255)
  );
}

/** localhost, 127.0.0.0/8 and ::1 — the only hosts allowed to speak plain http. */
export function isLoopback(host: string): boolean {
  const bare = stripBrackets(host);
  return (
    bare === LOOPBACK_NAME || bare === LOOPBACK_IPV6 || isLoopbackIpv4(bare)
  );
}

/**
 * Reads `WAVES_URL` into an origin. The URL is the origin and nothing else: a
 * path, a query or credentials in it is a mistake worth refusing rather than
 * silently dropping.
 */
export function readEndpoint(
  raw: string,
  allowInsecureHttp: boolean,
): EndpointResult {
  if (raw.trim() === "") {
    return { ok: false, error: "must not be empty" };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "must be an absolute URL" };
  }
  const secure = url.protocol === "https:";
  if (!secure && url.protocol !== "http:") {
    return { ok: false, error: "must use http: or https:" };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, error: "must not carry credentials" };
  }
  if (url.pathname !== "" && url.pathname !== "/") {
    return { ok: false, error: "must be an origin without a path" };
  }
  if (url.search !== "" || url.hash !== "") {
    return { ok: false, error: "must not carry a query or a fragment" };
  }
  if (!isHostName(url.hostname)) {
    return { ok: false, error: "must have a valid host" };
  }
  if (!secure && !isLoopback(url.hostname) && !allowInsecureHttp) {
    return {
      ok: false,
      error:
        "must use https:, or http: on a loopback host, or WAVES_ALLOW_INSECURE_HTTP=1",
    };
  }
  return {
    ok: true,
    endpoint: {
      origin: `${url.protocol}//${url.host}`,
      secure,
      warnInsecure: !secure && !isLoopback(url.hostname),
    },
  };
}

/** The one URL `--repo` accepts: an absolute https URL with a host. */
export function isHttpsUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    isHostName(url.hostname)
  );
}

/** The collection endpoint, with `rotate` asking the server for a new token. */
export function projectsPath(rotate: boolean): string {
  return rotate ? `${API_PREFIX}?rotate=1` : API_PREFIX;
}

export function wavePath(project: string, wave: string): string {
  return `${API_PREFIX}/${encodeURIComponent(project)}/waves/${encodeURIComponent(wave)}`;
}

/** The project's one status document, which a PUT replaces rather than adds to. */
export function statusPath(project: string): string {
  return `${API_PREFIX}/${encodeURIComponent(project)}/status`;
}

/** The URL of one decision, the route a `raise` PUTs and a `read` GETs. */
export function decisionPath(project: string, id: string): string {
  if (!isProjectId(project)) {
    throw new Error(`invalid project id: ${JSON.stringify(project)}`);
  }
  if (!isLaneId(id)) {
    throw new Error(`invalid decision id: ${JSON.stringify(id)}`);
  }
  return `${API_PREFIX}/${encodeURIComponent(project)}/decisions/${encodeURIComponent(id)}`;
}

/** `POST` for one project's state entries on one decision. */
export function decisionStatesPath(project: string, id: string): string {
  return `${decisionPath(project, id)}/states`;
}

/** `POST` for one project's events. */
export function eventsPath(project: string): string {
  return `${API_PREFIX}/${encodeURIComponent(project)}/events`;
}

/** The heads of every decision in one project. */
export function projectDecisionsPath(project: string): string {
  return `${API_PREFIX}/${encodeURIComponent(project)}/decisions`;
}

/**
 * The line printed before every request to an insecurely allowed host. A write
 * carries the project's token, so the warning names it; a read does not, so it
 * speaks plainly about the response instead — the host is still untrusted, but
 * no secret is crossing it.
 */
export function insecureWarning(origin: string, hasToken: boolean): string {
  const secret = hasToken
    ? "the token travels in clear text"
    : "the response is fetched in clear text";
  return `waves: ${origin} is plain http, so ${secret}`;
}
