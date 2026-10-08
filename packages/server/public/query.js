/**
 * The view's query string: the seven parameters a URL may carry, each with the
 * rule it has to pass. A parameter that is absent, empty or fails its rule is
 * simply not in the result — it is never echoed back into the page, and it is
 * never passed on. Nothing here displays a value; that is a view's business, and
 * only through `dom.js`.
 */

import { isWaveId } from "./patterns.js";

/** The reasons a lane can be asked about, in the order the URL writes them. */
const REASONS = [
  "failed",
  "disagreement",
  "checks",
  "gate",
  "exit",
  "silent",
  "no-pr",
];

/**
 * The tabs the fleet page is divided into, in the order it offers them. Absent
 * means every project, and `all` is never written: a filter that names its own
 * absence is one more thing to parse, and `/?tab=` means nothing to a reader who
 * copies the address.
 */
export const TABS = ["active", "flagged", "quiet"];

/** The contract's stage shape, and its own vocabulary length. */
const STAGE = /^[a-z][a-z-]{0,31}$/;

const SEAT_MAX = 128;
const Q_MAX = 80;

/** The order `formatQuery` writes in, whatever order the keys arrived in. */
const ORDER = ["tab", "reason", "stage", "seat", "q", "lane", "all"];

/**
 * A string of printable characters: nothing below U+0020 and not U+007F. A
 * control character in a filter would be invisible in a control, so it is not
 * one.
 */
function printable(value, max) {
  if (value.length === 0 || value.length > max) {
    return false;
  }
  for (let at = 0; at < value.length; at += 1) {
    const code = value.charCodeAt(at);
    if (code < 0x20 || code === 0x7f) {
      return false;
    }
  }
  return true;
}

function oneOf(value, allowed) {
  return allowed.includes(value) ? value : undefined;
}

/**
 * The first value of a parameter, or nothing. `URLSearchParams.get` is already
 * first-wins, and it never throws, which is what a query string typed by hand
 * needs.
 */
function first(params, name) {
  return params.get(name) ?? "";
}

export function parseQuery(search) {
  const query = { all: false };
  const params = new URLSearchParams(search);
  const tab = oneOf(first(params, "tab"), TABS);
  if (tab !== undefined) {
    query.tab = tab;
  }
  const reason = oneOf(first(params, "reason"), REASONS);
  if (reason !== undefined) {
    query.reason = reason;
  }
  const stage = first(params, "stage");
  if (STAGE.test(stage)) {
    query.stage = stage;
  }
  const seat = first(params, "seat");
  if (printable(seat, SEAT_MAX)) {
    query.seat = seat;
  }
  const q = first(params, "q");
  if (printable(q, Q_MAX)) {
    query.q = q;
  }
  const lane = first(params, "lane");
  if (isWaveId(lane)) {
    query.lane = lane;
  }
  query.all = first(params, "all") === "1";
  return query;
}

export function formatQuery(query) {
  const params = new URLSearchParams();
  for (const key of ORDER) {
    const value = query[key];
    if (value === undefined || (key === "all" && value !== true)) {
      continue;
    }
    params.append(key, key === "all" ? "1" : String(value));
  }
  const written = params.toString();
  return written === "" ? "" : `?${written}`;
}
