import { REASONS } from "../attention.js";
import { el, internalLink, repoLink, stamp, text } from "../dom.js";
import {
  aliveView,
  gateText,
  laneCountText,
  pullRequestText,
  reportedText,
} from "../format.js";
import { formatQuery } from "../query.js";
import { renderStatusPanel } from "./status-panel.js";
import { visibleWaves } from "../wave.js";

/**
 * One project's page: every lane of every wave it has pushed, in one table, with
 * the wave strip above it so a reader chooses a wave by following a link rather
 * than by asking for a second response. The listing has already passed
 * `drawableProjectLanes`, and this view reads nothing else, so every value it
 * draws is one the page can link to.
 *
 * Everything that leads somewhere is a link. The app follows its own links in
 * place, and a link is the one control a reader can open in a new tab, copy or
 * read aloud, which a button on a status page is none of. The two selects and
 * the search box are the only controls that are not links.
 */

/** The seven facts the table has, in the order it shows them. */
const COLUMNS = ["Lane", "Reported", "Alive", "PR", "Gate", "Reasons", "Notes"];

const NO_SUCH_WAVE = "No such wave in this project.";
const NO_WAVES = "This project has no waves yet.";
const NOTHING_IN_SCOPE = "No lanes in this scope.";
const NOTHING_MATCHES = "No lanes match.";
const NO_REASONS = "—";
const TRUNCATED =
  "This list was cut: the project has more lanes than one page carries.";

/** How many characters of search text the query string will carry. */
const Q_MAX = 80;

/** The lede under a wave's heading, once the name is in it. */
const LEDE_WAVE =
  ": what each lane reported, beside what the last push could derive.";
const LEDE_ALL = "Every lane of this project's waves. Choose a wave to narrow.";

function badge(label, kind) {
  return el("span", { attrs: { class: `badge ${kind}` }, text: label });
}

/** One cell, labelled for the narrow layout in `app.css`. */
function cell(label, children) {
  return el("td", { attrs: { "data-label": label }, children });
}

/**
 * The rows in scope: every row of the project on its own page, and only the rows
 * of the wave the path names on a wave's page.
 */
export function scopeOf(view, wave) {
  if (wave === undefined) {
    return view.lanes;
  }
  return view.lanes.filter((row) => row.wave === wave);
}

/**
 * The six numbers the page leads with, counted over the rows in scope rather than
 * over the response. A filter narrows the table and leaves these alone: a
 * counter that moved with the filter would be a second, contradicting answer to
 * the same question.
 */
export function countersOf(rows) {
  let alive = 0;
  let unknown = 0;
  let attention = 0;
  let disagreements = 0;
  let openPrs = 0;
  for (const row of rows) {
    if (row.derived.alive === true) {
      alive += 1;
    } else if (row.derived.alive === "unknown") {
      // A lane of a wave that has stopped arriving: the last push derived it
      // alive, and nothing since has said whether it still is.
      unknown += 1;
    }
    if (row.reasons.length > 0) {
      attention += 1;
    }
    if (row.disagreements > 0) {
      disagreements += 1;
    }
    if (row.derived.pr?.state === "open") {
      openPrs += 1;
    }
  }
  return {
    lanes: rows.length,
    alive,
    unknown,
    attention,
    disagreements,
    openPrs,
  };
}

/** How many rows carry each key, in the order the keys were first seen. */
function countedBy(rows, keyOf) {
  const counts = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * The seats in scope, busiest first, so the panel says where the work is before
 * it says which lane is on it. A seat is a pusher's own string, so ties are
 * broken by the plain `<` and not by a locale's idea of an alphabetical order,
 * and the lanes that recorded no seat sort last: that entry is the absence of an
 * answer rather than an answer of its own.
 */
export function seatsOf(rows) {
  return [...countedBy(rows, (row) => row.seat).entries()]
    .map(([seat, lanes]) => ({ seat, lanes }))
    .sort((left, right) => {
      if (left.seat === undefined) {
        return 1;
      }
      if (right.seat === undefined) {
        return -1;
      }
      if (left.lanes !== right.lanes) {
        return right.lanes - left.lanes;
      }
      return left.seat < right.seat ? -1 : 1;
    });
}

/**
 * The stages in scope, in the order the pushers first report them, and the lanes
 * that reported nothing last. The console has no vocabulary of its own: a stage
 * is a word the pusher chose, and the order it is shown in is the order it was
 * said in.
 */
export function stagesOf(rows) {
  return [...countedBy(rows, (row) => row.reported?.stage).entries()]
    .map(([stage, lanes]) => ({ stage, lanes }))
    .sort((left, right) => {
      if (left.stage === undefined) {
        return 1;
      }
      if (right.stage === undefined) {
        return -1;
      }
      return 0;
    });
}

/**
 * The wave heads in scope that are stale, which is what the banner above the
 * table is worded from. A wave route answers for its own wave whatever the strip
 * is showing: a reader who opened that wave's page is being told about that wave,
 * and being quiet because the retention hid it would be the one place staleness
 * is worth saying that says nothing.
 */
export function staleWavesOf(view, wave, all) {
  if (wave !== undefined) {
    const head = view.waves.find((entry) => entry.wave === wave);
    return head?.stale === true ? [head] : [];
  }
  return visibleWaves(view.waves, all).filter((head) => head.stale);
}

/**
 * Everything one lane can be searched for, one field to a line, and the ones the
 * lane does not carry left out rather than written down as nothing: a pull
 * request is found by its number with a `#` as it is written everywhere else on
 * the page, and the reported number beside the derived one is a second thing to
 * find under the same needle.
 */
function haystack(row) {
  const parts = [
    row.id,
    row.wave,
    row.seat,
    row.reported?.stage,
    row.reported?.event,
    row.derived.pr === undefined ? undefined : `#${row.derived.pr.number}`,
    row.reported?.pr === undefined ? undefined : `#${row.reported.pr}`,
    row.disagreement,
  ];
  return parts.filter((part) => part !== undefined).join("\n");
}

/**
 * Whether a row is one the reader's own filter is looking for. Every condition
 * is about the row's own answer, so a parameter the page cannot use — a seat
 * nobody in this scope is on — matches nothing rather than quietly matching
 * everything, and a reader who pasted one is told their table is empty instead
 * of being shown the wrong half of it.
 */
export function matches(row, query) {
  if (query.reason !== undefined && !row.reasons.includes(query.reason)) {
    return false;
  }
  if (query.stage !== undefined && query.stage !== row.reported?.stage) {
    return false;
  }
  if (query.seat !== undefined && query.seat !== row.seat) {
    return false;
  }
  if (query.q !== undefined) {
    return haystack(row).toLowerCase().includes(query.q.toLowerCase());
  }
  return true;
}

/** The rows the reader's filter leaves, in the order they were given. */
export function filterRows(rows, query) {
  return rows.filter((row) => matches(row, query));
}

/**
 * How many rows carry each of the six reasons, in the order `attention.js`
 * writes them. Every reason is answered, including the ones no row carries: a
 * chip that is not drawn still has a count to be found by, and the six are the
 * same six the server derives its rows' reasons from.
 */
export function reasonCounts(rows) {
  const carried = new Map();
  for (const row of rows) {
    for (const reason of row.reasons) {
      carried.set(reason, (carried.get(reason) ?? 0) + 1);
    }
  }
  return new Map(REASONS.map((reason) => [reason, carried.get(reason) ?? 0]));
}

/** The distinct values a field of the rows in scope holds, ascending. */
function distinctOf(rows, keyOf) {
  return [...countedBy(rows, keyOf).keys()]
    .filter((value) => value !== undefined)
    .sort((left, right) => (left < right ? -1 : 1));
}

/**
 * What a search box is allowed to put in the address: the first 80 characters,
 * with every control character taken out. `parseQuery` refuses a longer value or
 * one carrying a control character, so without this a pasted TAB writes an
 * address the page then empties the box for, under the reader's hands. A loop
 * over characters and not a pattern over control characters, which is the one
 * regular expression this repository refuses to hold.
 */
export function searchText(value) {
  let kept = "";
  for (let at = 0; at < Q_MAX && at < value.length; at += 1) {
    const code = value.charCodeAt(at);
    if (code < 0x20 || code === 0x7f) {
      continue;
    }
    kept += value[at];
  }
  // The cut can fall between the two halves of one character. Half a character
  // is not text: the address would carry a replacement mark in its place.
  const last = kept.charCodeAt(kept.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? kept.slice(0, -1) : kept;
}

/**
 * The path a route is drawn at. Every segment is one the shape check has held
 * to an id pattern, so the encoding only ever matters to a hand-built path.
 */
export function pathFor(projectId, wave) {
  const project = `/p/${encodeURIComponent(projectId)}`;
  return wave === undefined
    ? project
    : `${project}/w/${encodeURIComponent(wave)}`;
}

/** The path plus the reader's own query, so a filter survives a choice. */
export function hrefFor(projectId, wave, query) {
  return pathFor(projectId, wave) + formatQuery(query);
}

/** Where a wave sits in the response, which is newest first. */
function positionOf(waves, wave) {
  const at = waves.findIndex((head) => head.wave === wave);
  // A row whose wave the listing does not carry is older than every wave it
  // does, so it sorts last rather than first.
  return at === -1 ? waves.length : at;
}

/**
 * What a reader is looking for first: the lanes something is being asked about,
 * then the newest wave, then the lane id. A stable order matters more than the
 * order itself — a table that reorders itself every ten seconds cannot be read
 * down — and every tie is broken by a value that does not change.
 */
export function sortRows(rows, waves) {
  return [...rows].sort((left, right) => {
    const asked = right.reasons.length - left.reasons.length;
    if (asked !== 0) {
      return asked;
    }
    const newer = positionOf(waves, left.wave) - positionOf(waves, right.wave);
    if (newer !== 0) {
      return newer;
    }
    if (left.id === right.id) {
      return 0;
    }
    return left.id < right.id ? -1 : 1;
  });
}

function heading(model) {
  const wave = model.wave;
  return el("h1", {
    children: [
      wave === undefined
        ? text(model.lanes.project.name)
        : el("code", { text: wave }),
    ],
  });
}

function lede(view, wave) {
  if (wave === undefined) {
    return el("p", { attrs: { class: "lede" }, text: LEDE_ALL });
  }
  return el("p", {
    attrs: { class: "lede" },
    children: [text("One wave of "), text(view.project.name), text(LEDE_WAVE)],
  });
}

/** The project's repository, or nothing at all when it registered none. */
function repoLine(view) {
  if (view.project.repo === undefined) {
    return undefined;
  }
  return el("p", {
    attrs: { class: "repo" },
    children: [repoLink(view.project.repo, view.project.repo)],
  });
}

/** The project, with the wave it names when the path named one. */
function projectId(model) {
  return model.lanes.project.id;
}

/**
 * The query a link to another scope carries: the filters, and not the lane.
 * A lane id names a lane of one wave, and the same id recurs in other waves, so
 * carrying it to another scope would point at a lane the reader never chose.
 */
function scopeQuery(model) {
  return { ...model.query, lane: undefined };
}

/** The lanes of the waves the strip shows, by what each wave's head says. */
function shownLanes(model) {
  return visibleWaves(model.lanes.waves, model.query.all).reduce(
    (lanes, head) => lanes + head.lanes,
    0,
  );
}

function allLanesItem(model) {
  const current = model.wave === undefined;
  return el("li", {
    children: [
      internalLink(
        "all lanes",
        hrefFor(projectId(model), undefined, scopeQuery(model)),
        current ? { "aria-current": "page" } : {},
      ),
      el("span", {
        attrs: { class: "meta" },
        text: laneCountText(shownLanes(model)),
      }),
    ],
  });
}

/**
 * The rows the listing holds for one wave, which is what the chip's state is
 * decided from. The listing holds every row of every wave it carries heads for,
 * so this is the whole of the wave as far as this page is concerned.
 */
function rowsOfWave(view, wave) {
  return view.lanes.filter((row) => row.wave === wave);
}

/** A pull request that has been merged or closed has answered what it raised. */
function prSettled(row) {
  const state = row.derived.pr?.state;
  return state === "merged" || state === "closed";
}

/**
 * An exit status is a failure when it is a number and it is not zero. The two
 * predicates above are the ones `src/domain/attention.ts` holds, written out
 * again rather than imported: `public/` is served to the browser as it is and
 * cannot reach into the service's own source.
 */
function isFailureExit(exit) {
  return exit !== undefined && exit !== 0;
}

/**
 * What one wave's lanes say about the wave, in the order the plan's W35 decides
 * it in and in no other: `failed`, then `done`, then `running`, and `settled`
 * for everything else. `src/domain/wave-state.ts` holds the same rule for the
 * fleet route, which is answered a `state` per wave; this listing carries no
 * such field, so the chip works it out from the rows it is already holding —
 * the same vocabulary, the same order, and a colour beside the words the chip
 * already says.
 *
 * `stale` is the head's own answer rather than the rows': a wave past its own
 * interval has stopped saying what its lanes are doing, so an alive lane in one
 * is `settled` and not `running`. And a row's `alive` is the view's form, where
 * staleness has already turned a `true` into `"unknown"`, so only a `false` is
 * known to be a lane that is not alive.
 */
export function waveStateOf(rows, stale) {
  for (const row of rows) {
    if (
      !prSettled(row) &&
      row.derived.alive === false &&
      (row.reported?.event === "failed" || isFailureExit(row.derived.exit))
    ) {
      return "failed";
    }
  }
  if (rows.length > 0 && rows.every(prSettled)) {
    return "done";
  }
  if (!stale && rows.some((row) => row.derived.alive === true)) {
    return "running";
  }
  return "settled";
}

/**
 * The class each of the four states hangs its colour on, and the class a stale
 * wave carries beside the one its state gave it. Both are this file's own
 * literals and the state is chosen here: a class built from anything a listing
 * carries would be an attribute a pusher wrote.
 */
const WAVE_CLASS = {
  failed: "wave-failed",
  done: "wave-done",
  running: "wave-running",
  settled: "wave-settled",
  stale: "wave-stale",
};

/**
 * One wave's chip: its own state class, plus the stale one when the head says so.
 * The badge inside the chip is still what says "stale" in words — the class is
 * the colour beside that word, never instead of it.
 */
function waveItem(model, head, nowMs) {
  const children = [
    internalLink(
      head.wave,
      hrefFor(projectId(model), head.wave, scopeQuery(model)),
      model.wave === head.wave ? { "aria-current": "page" } : {},
    ),
    el("span", {
      attrs: { class: "meta" },
      text: laneCountText(head.lanes),
    }),
    stamp(head.receivedAt, nowMs),
  ];
  if (head.stale) {
    children.push(badge("stale", "stale"));
  }
  if (!head.retained) {
    children.push(badge("past retention", "aging"));
  }
  const state = waveStateOf(rowsOfWave(model.lanes, head.wave), head.stale);
  const classes = head.stale
    ? `wave ${WAVE_CLASS[state]} ${WAVE_CLASS.stale}`
    : `wave ${WAVE_CLASS[state]}`;
  return el("li", { attrs: { class: classes }, children });
}

/**
 * The waves, newest first, with the one being read marked. The waves past the
 * retention are left out until the reader asks for them, which is what the
 * toggle below the list is for: it is a link to the same page with the query
 * that asks for them, so the choice survives a copy of the address and a
 * refresh. The heads the route's own bound left out are said under the list,
 * because the strip is the only place a reader can see that they are not there.
 */
function waveStrip(model, nowMs) {
  const view = model.lanes;
  const children = [
    el("ul", {
      children: [
        allLanesItem(model),
        ...visibleWaves(view.waves, model.query.all).map((head) =>
          waveItem(model, head, nowMs),
        ),
      ],
    }),
  ];
  // The heads the route left out are older than every listed one, so they may
  // be the waves past retention; the toggle stays offered while any was left out.
  if (
    view.waves.some((head) => head.retained === false) ||
    view.wavesOmitted > 0
  ) {
    children.push(
      internalLink(
        model.query.all
          ? "hide waves past retention"
          : "show waves past retention",
        hrefFor(projectId(model), model.wave, {
          ...scopeQuery(model),
          all: !model.query.all,
        }),
      ),
    );
  }
  return el("nav", {
    attrs: { "aria-label": "Waves", class: "wave-strip" },
    children,
  });
}

/**
 * What the route's bound left out of the wave strip, said below it and only when
 * it left something out: a count of zero is an answer the reader already has.
 */
function omittedWaves(model) {
  const omitted = model.lanes.wavesOmitted;
  if (omitted === 0) {
    return [];
  }
  const one = omitted === 1;
  return [
    el("p", {
      attrs: { class: "note-inline" },
      text: `${omitted} older wave${one ? " is" : "s are"} not listed.`,
    }),
  ];
}

/** One number, with the name it counts, in a box of its own. */
function kpi(label, value, warn) {
  return el("div", {
    attrs: { class: warn ? "kpi warn" : "kpi" },
    children: [el("dt", { text: label }), el("dd", { text: String(value) })],
  });
}

/**
 * What the project itself last said about it: the pull-request rows a listing
 * could not read and the last `plan:verify` artifact. It sits under the counters
 * because that is where a reader looks for a project's own numbers, and it is not
 * a column of the lane table because none of it is about a lane — a filter
 * narrows the table and leaves this alone, exactly as it leaves the counters.
 *
 * A project that pushed no status has nothing here, and the panel draws nothing
 * at all rather than a panel saying so.
 */
function statusPanel(model, nowMs) {
  return model.status === undefined
    ? []
    : [renderStatusPanel(model.status, nowMs)];
}

/**
 * The six numbers of the rows in scope, above everything that reads a row. Three
 * of the six are warnings, and each says so in colour and in the number itself:
 * a counter that is only amber is a counter a reader who cannot see amber has not
 * read.
 */
function laneCounters(rows) {
  const counts = countersOf(rows);
  return el("dl", {
    attrs: { class: "kpis" },
    children: [
      kpi("Lanes", counts.lanes, false),
      kpi("Alive", counts.alive, false),
      kpi("Unknown", counts.unknown, counts.unknown > 0),
      kpi("Need attention", counts.attention, counts.attention > 0),
      kpi("Disagreements", counts.disagreements, counts.disagreements > 0),
      kpi("Open PRs", counts.openPrs, false),
    ],
  });
}

/** What a wave that has stopped arriving is said in, with and without a clock. */
const STALE_WAVE =
  "This wave is stale: no snapshot arrived inside its interval, so lanes last seen alive read unknown. Last received ";
const STALE_WAVE_NO_INTERVAL =
  "This wave is stale: no snapshot arrived since it was pushed without an interval, so lanes last seen alive read unknown. Last received ";
/** The end of the project's own sentence, which counts the waves instead. */
const STALE_TAIL = ": lanes last seen alive in them read unknown.";

/** The count of the waves the strip is showing, which is what the page can see. */
function manyStale(model, stale) {
  const shown = visibleWaves(model.lanes.waves, model.query.all).length;
  return `${stale} of ${shown} waves shown ${stale === 1 ? "is" : "are"} stale${STALE_TAIL}`;
}

/**
 * Why the numbers below it may not be trusted, said before they are. A wave's
 * own page gets that wave's sentence and the exact stamp of the last push; the
 * project's own page can only count the waves the strip is showing, so it counts
 * them. `role="status"` because a reader watching the page for a change has to be
 * told about this one without having to go looking for it.
 */
function staleBanner(model, nowMs, stale) {
  const head = model.wave === undefined ? undefined : stale[0];
  const children =
    head === undefined
      ? [text(manyStale(model, stale.length))]
      : [
          text(
            head.intervalSeconds === null ? STALE_WAVE_NO_INTERVAL : STALE_WAVE,
          ),
          stamp(head.receivedAt, nowMs),
          text("."),
        ];
  return el("p", {
    attrs: { class: "banner stale", role: "status" },
    children,
  });
}

/** What an empty list of disagreements is said in. */
const NOTHING_DISAGREES =
  "Nothing in this scope disagrees. A missing snapshot is still not agreement.";

/**
 * One lane that disagrees: the link to it, the wave it is in, what the two facts
 * said, and how many further disagreements are behind it. The count is only said
 * where there is a disagreement to count.
 *
 * The link carries no filter. The panel lists the scope and the table lists
 * what the filter leaves, so a link that kept the filter could lead to a wave's
 * page where the lane it names is filtered out of its own table.
 */
function disagreementItem(model, row) {
  const children = [
    internalLink(
      row.id,
      hrefFor(projectId(model), row.wave, {
        all: model.query.all,
        lane: row.id,
      }),
    ),
    el("code", { text: row.wave }),
    el("span", { attrs: { class: "disagreement" }, text: row.disagreement }),
  ];
  if (row.disagreements > 1) {
    children.push(
      el("span", {
        attrs: { class: "meta" },
        text: `+${row.disagreements - 1} more`,
      }),
    );
  }
  return el("li", { children });
}

/**
 * The rows whose reported and derived facts do not agree, in the order the table
 * shows them, so the panel and the table are read as one list. The empty line
 * says the half that is easy to forget: a lane that reported nothing has not
 * agreed with the last push, it has said nothing at all.
 */
function disagreementsPanel(model, scope) {
  const children = [el("h2", { text: "Disagreements" })];
  const rows = sortRows(
    scope.filter((row) => row.disagreements > 0),
    model.lanes.waves,
  );
  if (rows.length === 0) {
    children.push(
      el("p", { attrs: { class: "panel-empty" }, text: NOTHING_DISAGREES }),
    );
  } else {
    children.push(
      el("ul", {
        children: rows.map((row) => disagreementItem(model, row)),
      }),
    );
  }
  return el("section", {
    attrs: { class: "panel disagreements" },
    children,
  });
}

/** How many seats the panel names by name, and what the rest are called. */
const SEATS_NAMED = 8;
const OTHERS = "others";
const NO_SEAT = "no seat recorded";

/** One seat: its name, how much of the scope is under it, and that as a number. */
function seatItem(name, lanes, scope) {
  return el("li", {
    children: [
      el("span", { attrs: { class: "name" }, text: name }),
      el("meter", { attrs: { value: lanes, max: scope } }),
      el("span", { attrs: { class: "count" }, text: String(lanes) }),
    ],
  });
}

/**
 * The seats in scope, busiest first, eight of them by name and then one line for
 * everything left: a project with a hundred seats is showing which few hold the
 * work, and the rest belong in a number rather than in a hundred rows of their
 * own. Each meter is measured against every row in scope, so two rows read the
 * same on every seat and the panel cannot say more than it has.
 */
function seatsPanel(scope) {
  const heading = el("h2", { text: "Seats" });
  if (scope.length === 0) {
    return el("section", {
      attrs: { class: "panel seats" },
      children: [
        heading,
        el("p", { attrs: { class: "panel-empty" }, text: NOTHING_IN_SCOPE }),
      ],
    });
  }
  const entries = seatsOf(scope);
  const items = entries
    .slice(0, SEATS_NAMED)
    .map((entry) => seatItem(entry.seat ?? NO_SEAT, entry.lanes, scope.length));
  if (entries.length > SEATS_NAMED) {
    const lanes = entries
      .slice(SEATS_NAMED)
      .reduce((total, entry) => total + entry.lanes, 0);
    items.push(seatItem(OTHERS, lanes, scope.length));
  }
  return el("section", {
    attrs: { class: "panel seats" },
    children: [heading, el("ul", { children: items })],
  });
}

/** What the lanes that reported no stage at all are called. */
const NOT_REPORTED = "not reported";

/** The stages in scope, in the order the pushers reported them, with their counts. */
function stageRail(scope) {
  return el("ul", {
    attrs: { class: "stages" },
    children: stagesOf(scope).map((entry) =>
      el("li", {
        children: [
          el("span", {
            attrs: { class: "name" },
            text: entry.stage ?? NOT_REPORTED,
          }),
          el("span", { attrs: { class: "count" }, text: String(entry.lanes) }),
        ],
      }),
    ),
  });
}

/**
 * The six reasons as chips, each with the number of rows in scope that carry it.
 * The chips are links and not buttons, so a filter is a place a reader can be
 * sent, read aloud, copied or opened in a new tab, and the address is where the
 * filter lives. A reason no row carries is left out; the one the reader has
 * chosen is always there, because a chip that vanished under the reader's cursor
 * is a chip that cannot be turned off.
 */
function reasonChips(model, scope) {
  const active = model.query.reason;
  const children = [
    internalLink(
      "all",
      hrefFor(projectId(model), model.wave, {
        ...model.query,
        reason: undefined,
        lane: undefined,
      }),
      active === undefined ? { "aria-current": "true" } : {},
    ),
  ];
  for (const [reason, count] of reasonCounts(scope)) {
    if (count === 0 && reason !== active) {
      continue;
    }
    const current = reason === active;
    children.push(
      internalLink(
        `${reason} · ${count}`,
        hrefFor(projectId(model), model.wave, {
          ...model.query,
          reason: current ? undefined : reason,
          lane: undefined,
        }),
        current ? { "aria-current": "true" } : {},
      ),
    );
  }
  return el("nav", {
    attrs: { "aria-label": "Reasons", class: "chips" },
    children,
  });
}

/**
 * One of the two filters a reader chooses from a list: the seats in scope, or the
 * stages their lanes reported. The filter's own key is the control's `name` and
 * its `data-key`, which is what makes a chosen filter something the address can
 * carry and this page can find again. Every value in the list is a pusher's own
 * string, and it is carried in the option's `value` attribute rather than left to
 * the implicit one, which collapses runs of whitespace and would hand the address
 * a seat nobody wrote. The `id` is this page's literal: a pusher chooses seats
 * and stages, never the name of a control.
 */
function selectFilter({ id, key, label, all, options, chosen, handlers }) {
  const select = el("select", {
    attrs: { id, name: key, "data-key": key },
    children: [
      el("option", { attrs: { value: "" }, text: all }),
      ...options.map((option) =>
        el("option", { attrs: { value: option }, text: option }),
      ),
    ],
  });
  // A select reads its own value off the option that matches, and a filter
  // nobody in this scope holds is not one of them: it is shown as off, and the
  // table below it is empty, which is what such a filter really means.
  select.value = chosen !== undefined && options.includes(chosen) ? chosen : "";
  select.addEventListener("change", () => {
    handlers.onFilter({
      [key]: select.value === "" ? undefined : select.value,
    });
  });
  return [el("label", { attrs: { for: id }, text: label }), select];
}

/**
 * The search box. Its value is the reader's own query, written through the
 * attribute table like every other value on this page, and what it hands back is
 * cut and cleaned by `searchText` so that what the address can carry and what
 * the box holds are the same thing.
 *
 * A character still being composed is not asked for: asking redraws the page,
 * and replacing the box under an input method ends the composition, so a reader
 * composing a character could never finish one. The search runs when the
 * composition ends.
 */
function searchFilter(chosen, handlers) {
  const input = el("input", {
    attrs: {
      type: "search",
      id: "filter-q",
      name: "q",
      "data-key": "q",
      placeholder: "lane, seat, PR…",
      value: chosen ?? "",
    },
  });
  input.addEventListener("input", (event) => {
    if (event.isComposing === true) {
      return;
    }
    handlers.onSearch(searchText(input.value));
  });
  input.addEventListener("compositionend", () => {
    handlers.onSearch(searchText(input.value));
  });
  return [el("label", { attrs: { for: "filter-q" }, text: "Search" }), input];
}

/**
 * The copy button and what it last said. It carries `data-key="digest"`, so the
 * app's own focus code finds it again by that key after the redraw the copy
 * causes — otherwise the reader's focus would be dropped at the top of the page
 * by a control they are still using. The note beside it is a status region, so
 * that copying is something a reader is told rather than something they have to
 * notice.
 */
function copyDigest(model, handlers) {
  const button = el("button", {
    attrs: { type: "button", "data-key": "digest", class: "copy" },
    text: "Copy digest",
  });
  button.addEventListener("click", () => {
    handlers.onCopy();
  });
  return [
    button,
    el("span", {
      attrs: { class: "copied", role: "status", "aria-live": "polite" },
      text: model.copied ?? "",
    }),
  ];
}

/**
 * The filters, over the rows in scope and not over the rows the filter leaves:
 * a chip's count is what it is about to show, so it cannot be the count of what
 * is on screen already. The count at the end is the one number the filter does
 * move, and it is a status region so that narrowing the table is something a
 * reader is told rather than something they have to notice.
 */
function toolbar(model, scope, handlers) {
  const shown = filterRows(scope, model.query).length;
  return el("div", {
    attrs: { class: "toolbar" },
    children: [
      reasonChips(model, scope),
      ...selectFilter({
        id: "filter-seat",
        key: "seat",
        label: "Seat",
        all: "all seats",
        options: distinctOf(scope, (row) => row.seat),
        chosen: model.query.seat,
        handlers,
      }),
      ...selectFilter({
        id: "filter-stage",
        key: "stage",
        label: "Stage",
        all: "all stages",
        options: distinctOf(scope, (row) => row.reported?.stage),
        chosen: model.query.stage,
        handlers,
      }),
      ...searchFilter(model.query.q, handlers),
      el("span", {
        attrs: { class: "shown", role: "status" },
        text: `${shown} of ${scope.length} shown`,
      }),
      ...copyDigest(model, handlers),
    ],
  });
}

/** The lane itself, and on the project's own page which wave it is in. */
function laneCell(model, row) {
  const parts = [
    internalLink(
      row.id,
      hrefFor(projectId(model), row.wave, {
        ...model.query,
        lane: row.id,
      }),
    ),
  ];
  if (model.wave === undefined) {
    parts.push(el("code", { attrs: { class: "in-wave" }, text: row.wave }));
  }
  if (row.seat !== undefined) {
    parts.push(el("small", { attrs: { class: "seat" }, text: row.seat }));
  }
  return cell("Lane", parts);
}

function reportedCell(row, nowMs) {
  const parts = [text(reportedText(row.reported))];
  if (row.reported !== undefined) {
    parts.push(stamp(row.reported.ts, nowMs));
  }
  return cell("Reported", parts);
}

/** Liveness as the last push derived it, with the two facts beside it. */
function aliveCell(row) {
  const derived = row.derived;
  const alive = aliveView(derived.alive);
  const parts = [badge(alive.label, alive.className)];
  if (derived.exit !== undefined) {
    parts.push(
      el("span", { attrs: { class: "meta" }, text: `exit ${derived.exit}` }),
    );
  }
  if (derived.log !== undefined) {
    parts.push(
      el("span", {
        attrs: { class: "meta" },
        text: derived.log.tail ? "tail pushed" : "no tail",
      }),
    );
  }
  return cell("Alive", parts);
}

/**
 * The derived pull request, and the lane's own when the two disagree. A reported
 * number with no derived pull request at all is the disagreement that matters
 * most, so it is shown rather than passed over.
 */
function prCell(row) {
  const reported = row.reported?.pr;
  const parts = [text(pullRequestText(row.derived.pr))];
  if (reported !== undefined && reported !== row.derived.pr?.number) {
    parts.push(
      el("span", {
        attrs: { class: "mismatch" },
        text: `reported #${reported}`,
      }),
    );
  }
  return cell("PR", parts);
}

function gateCell(row) {
  return cell("Gate", [text(gateText(row.derived.gate))]);
}

function reasonsCell(row) {
  if (row.reasons.length === 0) {
    return cell("Reasons", [text(NO_REASONS)]);
  }
  return cell(
    "Reasons",
    row.reasons.map((reason) => badge(reason, "reason")),
  );
}

/**
 * The first disagreement and how many more there are, then the two notes the
 * last push left. `disagreements` counts what the server has and
 * `disagreement` is the first of them, so the count is only said where there is
 * a disagreement to count.
 */
function notesCell(row) {
  const parts = [];
  if (row.disagreement !== undefined) {
    parts.push(
      el("span", {
        attrs: { class: "disagreement" },
        text: row.disagreement,
      }),
    );
    if (row.disagreements > 1) {
      parts.push(
        el("span", {
          attrs: { class: "meta" },
          text: `+${row.disagreements - 1} more`,
        }),
      );
    }
  }
  if (row.derived.planReview !== undefined) {
    parts.push(
      el("span", { attrs: { class: "meta" }, text: row.derived.planReview }),
    );
  }
  if (row.derived.risk !== undefined) {
    parts.push(
      el("span", { attrs: { class: "meta" }, text: row.derived.risk }),
    );
  }
  return cell("Notes", parts);
}

/** A row is the one the reader chose when the query names it in this scope. */
function isCurrent(model, row) {
  return (
    row.id === model.query.lane &&
    (model.wave === undefined || row.wave === model.wave)
  );
}

function laneRow(model, row, nowMs) {
  // The background colour says which row the reader chose; this says it to a
  // screen reader and to a reader who cannot see a background at all.
  const current = isCurrent(model, row);
  return el("tr", {
    attrs: current
      ? { class: "lane current", "aria-current": "true" }
      : { class: "lane" },
    children: [
      laneCell(model, row),
      reportedCell(row, nowMs),
      aliveCell(row),
      prCell(row),
      gateCell(row),
      reasonsCell(row),
      notesCell(row),
    ],
  });
}

function laneTable(model, rows, nowMs) {
  return el("table", {
    attrs: { class: "lanes" },
    children: [
      el("thead", {
        children: [
          el("tr", {
            children: COLUMNS.map((label) => el("th", { text: label })),
          }),
        ],
      }),
      el("tbody", {
        children: rows.map((row) => laneRow(model, row, nowMs)),
      }),
    ],
  });
}

/**
 * The table on the glass card every other panel of the page is on, so the
 * hairlines between the rows and the band its header sits in have a surface to
 * be drawn on. The narrow layout in `app.css` turns each row into a card of its
 * own, and this is the card those cards sit on.
 */
function lanesCard(children) {
  return el("div", { attrs: { class: "lanes-card" }, children });
}

const PAST_RETENTION =
  "This wave is past retention. Show the waves past retention to list its lanes.";

/** Whether the path names a wave whose lanes were not asked for. */
function waveLeftOut(model) {
  return (
    !model.query.all &&
    model.lanes.waves.some(
      (head) => head.wave === model.wave && head.retained === false,
    )
  );
}

/**
 * Why there is no table: nothing pushed, a wave whose lanes this listing left
 * out, or nothing in this scope. The middle one is said apart because the wave
 * does hold lanes: "no lanes" would be false, and the link under the strip is
 * how the reader gets them.
 */
function emptyMessage(model) {
  const view = model.lanes;
  let text = NOTHING_IN_SCOPE;
  if (view.waves.length === 0) {
    text = NO_WAVES;
  } else if (waveLeftOut(model)) {
    text = PAST_RETENTION;
  }
  return el("p", { attrs: { class: "empty" }, text });
}

export function renderProject(model, nowMs, handlers) {
  const view = model.lanes;
  const children = [heading(model), lede(view, model.wave)];
  const repo = repoLine(view);
  if (repo !== undefined) {
    children.push(repo);
  }
  if (
    model.wave !== undefined &&
    !view.waves.some((h) => h.wave === model.wave)
  ) {
    // The path named a wave this project does not have. The strip is still
    // drawn, because it is how the reader gets back to a wave that is.
    children.push(
      el("p", { attrs: { class: "empty" }, text: NO_SUCH_WAVE }),
      waveStrip(model, nowMs),
      ...omittedWaves(model),
    );
    return el("section", {
      attrs: { class: "view project" },
      children,
    });
  }
  children.push(waveStrip(model, nowMs), ...omittedWaves(model));
  const scope = scopeOf(view, model.wave);
  children.push(laneCounters(scope));
  children.push(...statusPanel(model, nowMs));
  const stale = staleWavesOf(view, model.wave, model.query.all);
  if (stale.length > 0) {
    children.push(staleBanner(model, nowMs, stale));
  }
  children.push(
    el("div", {
      attrs: { class: "split" },
      children: [disagreementsPanel(model, scope), seatsPanel(scope)],
    }),
  );
  if (scope.length > 0) {
    children.push(stageRail(scope));
    children.push(toolbar(model, scope, handlers));
    // The filter narrows the table and nothing else: the counters, the banner,
    // the panels and the rail above are about the scope, and a reader who
    // filtered to one seat is still looking at one project's whole wave.
    const shown = sortRows(filterRows(scope, model.query), view.waves);
    if (shown.length === 0) {
      children.push(
        el("p", { attrs: { class: "empty" }, text: NOTHING_MATCHES }),
      );
    } else {
      children.push(lanesCard([laneTable(model, shown, nowMs)]));
    }
  } else {
    children.push(emptyMessage(model));
  }
  if (view.truncated) {
    children.push(
      el("p", { attrs: { class: "note-inline" }, text: TRUNCATED }),
    );
  }
  return el("section", {
    attrs: { class: "view project" },
    children,
  });
}
