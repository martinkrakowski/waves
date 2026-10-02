import { el, internalLink, repoLink, stamp, text } from "../dom.js";
import {
  aliveView,
  gateText,
  laneCountText,
  pullRequestText,
  reportedText,
} from "../format.js";
import { formatQuery } from "../query.js";
import { visibleWaves } from "../wave.js";

/**
 * One project's page: every lane of every wave it has pushed, in one table, with
 * the wave strip above it so a reader chooses a wave by following a link rather
 * than by asking for a second response. The listing has already passed
 * `drawableProjectLanes`, and this view reads nothing else, so every value it
 * draws is one the page can link to.
 *
 * Every control here is a link. The app follows its own links in place, and a
 * link is the one control a reader can open in a new tab, copy or read aloud,
 * which a button on a status page is none of.
 */

/** The seven facts the table has, in the order it shows them. */
const COLUMNS = ["Lane", "Reported", "Alive", "PR", "Gate", "Reasons", "Notes"];

const NO_SUCH_WAVE = "No such wave in this project.";
const NO_WAVES = "This project has no waves yet.";
const NOTHING_IN_SCOPE = "No lanes in this scope.";
const NO_REASONS = "—";
const TRUNCATED =
  "This list was cut: the project has more lanes than one page carries.";

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
  return el("li", { children });
}

/**
 * The waves, newest first, with the one being read marked. The waves past the
 * retention are left out until the reader asks for them, which is what the
 * toggle below the list is for: it is a link to the same page with the query
 * that asks for them, so the choice survives a copy of the address and a
 * refresh.
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
  if (view.waves.some((head) => head.retained === false)) {
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
  return el("tr", {
    attrs: { class: isCurrent(model, row) ? "lane current" : "lane" },
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

export function renderProject(model, nowMs) {
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
    );
    return el("section", {
      attrs: { class: "view project" },
      children,
    });
  }
  children.push(waveStrip(model, nowMs));
  const rows = sortRows(scopeOf(view, model.wave), view.waves);
  if (rows.length === 0) {
    children.push(emptyMessage(model));
  } else {
    children.push(laneTable(model, rows, nowMs));
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
