/**
 * Two builders for the decision page: the history timeline and the earlier
 * texts. The history merges every revision and state entry into one list
 * ordered newest first, and the earlier texts are each a `<details>` showing
 * what that revision read as. Both take the model from `decision-model.js`.
 *
 * The history is where the page says what happened over time: when the question
 * was raised, when a revision changed the wording, and what each session entry
 * recorded. It is read-only: no answer is taken here.
 */

import { calendarDate } from "../format.js";
import { el, internalLink, text } from "../dom.js";
import { doorBand, SHAPE_WORD, DECIDER_WORD } from "./inbox.js";

const ANSWER_STATES = ["approved", "declined", "answered"];
const HISTORY_HEADING = "History";

function isAnswer(state) {
  return ANSWER_STATES.includes(state);
}

/** Whether any answer entry was recorded on a given text hash. */
function answerOnText(entries, hash) {
  return entries.some((e) => e.textSha256 === hash && isAnswer(e.state));
}

/**
 * Every revision as the history reads it: revision 1 first, with no changes;
 * each later revision carries what changed from the one before it, so the page
 * can say "at revision N, the question changed" without comparing in the view.
 */
function allRevisions(model) {
  const rcs = model.revisionChanges;
  if (rcs.length === 0) {
    const cr = model.currentRevision;
    return [
      {
        revision: cr.revision,
        receivedAt: cr.receivedAt,
        textSha256: cr.textSha256,
        decision: cr.decision,
        changeNote: cr.decision.changeNote,
        changes: [],
      },
    ];
  }
  const items = [
    {
      revision: rcs[0].revision,
      receivedAt: rcs[0].receivedAt,
      textSha256: rcs[0].textSha256,
      decision: rcs[0].decision,
      changeNote: undefined,
      changes: [],
    },
  ];
  for (let i = 1; i < rcs.length; i++) {
    const rc = rcs[i];
    items.push({
      revision: rc.revision,
      receivedAt: rc.receivedAt,
      textSha256: rc.textSha256,
      decision: rc.decision,
      changeNote: rc.changeNote,
      changes: rcs[i - 1].changed,
    });
  }
  const cr = model.currentRevision;
  items.push({
    revision: cr.revision,
    receivedAt: cr.receivedAt,
    textSha256: cr.textSha256,
    decision: cr.decision,
    changeNote: cr.decision.changeNote,
    changes: rcs[rcs.length - 1].changed,
  });
  return items;
}

/** The "what changed" phrase for a revision line. */
function changesText(changes) {
  return changes.length === 0
    ? "no text changed"
    : `${changes.join(", ")} changed`;
}

/** The DOM children for one entry, by its state. */
function entryChildren(entry, onEarlierText, project) {
  const kids = [];
  if (entry.state === "delegated") {
    kids.push(
      text(
        `${entry.by} decided under delegation: ${entry.option ?? entry.words}`,
      ),
    );
  } else if (entry.state === "withdrawn") {
    kids.push(text(`${entry.by} withdrew this question: ${entry.reason}`));
  } else if (entry.state === "superseded") {
    kids.push(text(`${entry.by} replaced this with `));
    kids.push(
      internalLink(entry.supersededBy, `/p/${project}/d/${entry.supersededBy}`),
    );
  } else {
    let line = `${entry.by} recorded that you ${entry.state}`;
    if (entry.option !== undefined) {
      line += ` (${entry.option})`;
    }
    line += ` on ${calendarDate(entry.receivedAt)}`;
    if (entry.words !== undefined) {
      line += `: "${entry.words}"`;
    }
    kids.push(text(line));
    if (entry.source === "reported") {
      kids.push(
        el("small", {
          attrs: { class: "card-small" },
          text: " reported, not signed",
        }),
      );
    }
  }
  if (onEarlierText) {
    kids.push(text(" (on an earlier text)"));
  }
  return kids;
}

/**
 * The history section: revisions and entries merged by receive time, newest
 * first. Revision 1 is "Raised by"; each later revision says what changed from
 * the one before it, and "the wording an answer was given to is no longer
 * current" when an answer sat on the text it replaced.
 */
export function historyBlock(model) {
  const revs = allRevisions(model);
  const events = [];
  for (let i = 0; i < revs.length; i++) {
    const rev = revs[i];
    if (i === 0) {
      events.push({
        at: rev.receivedAt,
        children: [
          text(
            `Raised by ${rev.decision.raisedBy} on ${calendarDate(rev.receivedAt)}.`,
          ),
        ],
      });
    } else {
      const prev = revs[i - 1];
      const wording =
        rev.changes.length > 0 &&
        answerOnText(model.earlierEntries, prev.textSha256);
      let line = `Revision ${rev.revision} on ${calendarDate(rev.receivedAt)}: ${changesText(rev.changes)}.`;
      if (rev.changeNote) {
        line += ` ${rev.changeNote}.`;
      }
      if (wording) {
        line += " The wording an answer was given to is no longer current.";
      }
      events.push({ at: rev.receivedAt, children: [text(line)] });
    }
  }
  for (const entry of [...model.currentEntries, ...model.earlierEntries]) {
    const onEarlier = model.earlierEntries.includes(entry);
    events.push({
      at: entry.receivedAt,
      children: entryChildren(entry, onEarlier, model.head.project),
    });
  }
  events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return el("section", {
    attrs: { class: "decision-history" },
    children: [
      el("h2", { text: HISTORY_HEADING }),
      el("ul", {
        attrs: { class: "history" },
        children: events.map((e) =>
          el("li", { attrs: { class: "history-event" }, children: e.children }),
        ),
      }),
    ],
  });
}

/** One earlier revision in a `<details>`, showing what it read as. */
function earlierTextDetails(rc) {
  const d = rc.decision;
  const children = [
    el("p", { attrs: { class: "earlier-question" }, text: d.question }),
    el("p", {
      attrs: { class: "earlier-facts" },
      text: `${SHAPE_WORD[d.shape]} · ${DECIDER_WORD[d.decider]}`,
    }),
  ];
  if (d.options.length > 0) {
    children.push(
      el("ul", {
        attrs: { class: "earlier-options" },
        children: d.options.map((o) =>
          el("li", { text: `${o.key}: ${o.text} — Cost: ${o.cost}` }),
        ),
      }),
    );
  }
  if (d.recommended !== undefined) {
    children.push(
      el("p", {
        attrs: { class: "earlier-recommended" },
        text: `Recommended: ${d.recommended.option} — ${d.recommended.reason}`,
      }),
    );
  }
  const band = doorBand({ door: d.hardToUndo });
  if (band !== undefined) {
    children.push(el("div", { attrs: { class: "door-band" }, text: band }));
  }
  if (d.commits.length > 0) {
    children.push(
      el("ul", {
        attrs: { class: "earlier-commits" },
        children: d.commits.map((c) => el("li", { text: c })),
      }),
    );
  }
  if (d.appliesTo.length > 0) {
    children.push(
      el("p", {
        attrs: { class: "earlier-applies-to" },
        text: `Applies to: ${d.appliesTo.join(", ")}`,
      }),
    );
  }
  if (d.actElsewhere !== undefined) {
    children.push(
      el("p", {
        attrs: { class: "card-elsewhere" },
        text: `Cannot be answered here. Act in: ${d.actElsewhere.where}: ${d.actElsewhere.what}.`,
      }),
    );
  }
  return el("details", {
    attrs: { class: "earlier-text" },
    children: [
      el("summary", { text: `Revision ${rc.revision}, as it read` }),
      el("div", { attrs: { class: "earlier-text-body" }, children }),
    ],
  });
}

/** The earlier texts section: one `<details>` per revision before the current. */
export function earlierTextsBlock(model) {
  if (model.revisionChanges.length === 0) {
    return undefined;
  }
  return el("section", {
    attrs: { class: "decision-earlier-texts" },
    children: model.revisionChanges.map(earlierTextDetails),
  });
}
