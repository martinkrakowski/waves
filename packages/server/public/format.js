const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const JUST_NOW_MS = 5 * SECOND;

const UNKNOWN = "unknown";

function percent(value) {
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`;
}

export function relativeTime(iso, nowMs) {
  const age = nowMs - Date.parse(iso ?? "");
  if (Number.isNaN(age)) {
    return UNKNOWN;
  }
  if (age < JUST_NOW_MS) {
    return "just now";
  }
  if (age < MINUTE) {
    return `${Math.floor(age / SECOND)}s ago`;
  }
  if (age < HOUR) {
    return `${Math.floor(age / MINUTE)}m ago`;
  }
  if (age < DAY) {
    return `${Math.floor(age / HOUR)}h ago`;
  }
  return `${Math.floor(age / DAY)}d ago`;
}

export function aliveView(alive) {
  if (alive === true) {
    return { label: "running", className: "running" };
  }
  if (alive === false) {
    return { label: "stopped", className: "stopped" };
  }
  return { label: UNKNOWN, className: UNKNOWN };
}

export function gateText(gate) {
  if (gate === undefined) {
    return "no gate reported";
  }
  const exit =
    gate.exit === undefined ? "exit not reported" : `exit ${gate.exit}`;
  if (gate.coverage === undefined) {
    return exit;
  }
  const coverage = gate.coverage;
  return `${exit} · ${percent(coverage.statements)} stmts · ${percent(coverage.branches)} br · ${percent(coverage.functions)} funcs · ${percent(coverage.lines)} lines`;
}

export function diffText(diff) {
  if (diff === undefined) {
    return "no diff reported";
  }
  return `${diff.files} files · +${diff.insertions} −${diff.deletions}`;
}

export function threadsText(threads) {
  if (threads === undefined) {
    return "threads not reported";
  }
  if (threads === UNKNOWN) {
    return "threads unknown";
  }
  if (threads === 0) {
    return "no open threads";
  }
  return threads === 1 ? "1 open thread" : `${threads} open threads`;
}

export function pullRequestText(pr) {
  if (pr === undefined) {
    return "no pull request reported";
  }
  return `#${pr.number} ${pr.state} · checks ${pr.checks} · ${threadsText(pr.unresolvedThreads)}`;
}

export function reportedText(reported) {
  if (reported === undefined) {
    return "nothing reported";
  }
  const parts = [reported.stage, reported.event];
  if (reported.round !== undefined) {
    parts.push(`round ${reported.round}`);
  }
  if (reported.pr !== undefined) {
    parts.push(`PR #${reported.pr}`);
  }
  return parts.join(" · ");
}

export function detailValue(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function laneCountText(lanes) {
  return lanes === 1 ? "1 lane" : `${lanes} lanes`;
}

export function waveCountText(waves) {
  return waves === 1 ? "1 wave" : `${waves} waves`;
}

/**
 * The wall clock, as `HH:MM:SS` in the reader's own time zone.
 *
 * Local, never UTC: the pill says when this page last loaded, and the reader is
 * the one who has to recognise that time as theirs. Every field is padded to two
 * digits because a clock that drops the leading zero reads as a different time of
 * day. Nothing is parsed and no zone is named, so there is nothing to go wrong
 * beyond a browser with no time zone, which has one anyway.
 */
export function clockTime(milliseconds) {
  const when = new Date(milliseconds);
  const hours = String(when.getHours()).padStart(2, "0");
  const minutes = String(when.getMinutes()).padStart(2, "0");
  const seconds = String(when.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * A timestamp as a calendar date and time, in UTC: "2026-10-09 at 06:25 UTC".
 *
 * The date is shown so a reader can pin a session's report to a moment they
 * might remember — "just now" or "2m ago" could be anything inside the window.
 * The time is UTC because the server is the only clock this page trusts for a
 * decision's `at`, and a wall-clock time would invite the reader to read
 * timezone into a field the server never named.
 */
export function calendarDate(iso) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    return "unknown";
  }
  const when = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  const year = String(when.getUTCFullYear()).padStart(4, "0");
  return `${year}-${pad(when.getUTCMonth() + 1)}-${pad(when.getUTCDate())} at ${pad(when.getUTCHours())}:${pad(when.getUTCMinutes())} UTC`;
}
