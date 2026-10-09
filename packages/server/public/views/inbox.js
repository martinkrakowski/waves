/**
 * The inbox page: every project's decisions that wait on the owner. It is given
 * a model already past its shape check — the four counts, the sorted projects and
 * the heads split into their three groups — and it returns a node for the shell
 * to put in its page area.
 *
 * The page takes no answers: no button, no input, no form. A decision is read
 * here and answered in the session that owns it, and the word for that is at the
 * foot of the page, not in a control.
 */

import { countLine } from "./inbox-model.js";
import { calendarDate } from "../format.js";
import { el, internalLink, stamp, text } from "../dom.js";

/** A heading over one project's block of decisions. */
const HEADING = "Inbox";

/** The line at the foot of the page, saying what the page is for. */
const FOOTER =
  "This page shows decisions; it does not take answers. A session's own permission prompt can only be cleared in that session.";

/** What a project with no decisions in it is said in one line. */
const EMPTY = "nothing waiting";

/** The three group headings, in the order the page draws them. */
const GROUP_HEAD = {
  waiting: "Waiting on you",
  reported: "Reported as answered",
  closed: "Closed by a session",
};

/**
 * The shape, in a word: "choice", "action only you run", "standing instruction".
 * These are the page's own words for the three shapes, not the shape value itself.
 */
const SHAPE_WORD = {
  choice: "choice",
  action: "action only you run",
  instruction: "standing instruction",
};

/**
 * Who may decide, in a word: "yours to decide" or "may be decided under
 * delegation". The page says it in the reader's own terms, not the stored value.
 */
const DECIDER_WORD = {
  owner: "yours to decide",
  delegated: "may be decided under delegation",
};

/**
 * The closed line reads the session's action in its own terms: a withdrawal
 * withdrew, a supersession replaced — and the page adds nothing to it.
 */
const CLOSED_ACTION = {
  withdrawn: "withdrew this question",
  superseded: "replaced this with a later decision",
};

/**
 * The door band, if the door is not `false`. `true` is a one-way door and
 * "partly" is partly undoable; `false` has no band at all. The page adds nothing
 * to the reason: the label is the stored words, and the reason the session wrote
 * is shown verbatim, character for character, as text and never as markup. A band
 * with no reason shows the label alone.
 */
function doorBand(head) {
  if (head.door.value === false) {
    return undefined;
  }
  const label = head.door.value === true ? "ONE-WAY DOOR:" : "PARTLY UNDOABLE:";
  return head.door.reason ? `${label} ${head.door.reason}` : label;
}

/**
 * One line of facts about a head: the shape, who may decide, and the revision
 * when the decision has more than one. The three are joined so a card the has
 * no business showing a revision does not leave a trailing separator.
 */
function factsLine(head) {
  const parts = [SHAPE_WORD[head.shape], DECIDER_WORD[head.decider]];
  if (head.revisions > 1) {
    parts.push(`revision ${head.revision} of ${head.revisions}`);
  }
  return parts.join(" · ");
}

/**
 * The state line a head carries, by its group. "Waiting on you" has nothing
 * more for an open owner decision; "Reported as answered" names the verdict in a
 * full sentence and never as the bare word "Approved"; "Closed by a session"
 * says what the session did and, when an answer was reported first, says so
 * beside it without striking it out.
 */
function stateNodes(head) {
  const nodes = [];
  if (head.group === "waiting") {
    if (head.state === "delegated") {
      nodes.push(
        el("p", {
          attrs: { class: "card-state" },
          text: "Decided under delegation. Awaiting your confirmation.",
        }),
      );
    } else if (head.decider === "delegated") {
      // open, delegated: still waiting on this decision's text.
      nodes.push(
        el("p", {
          attrs: { class: "card-state" },
          text: "May be decided under delegation; not decided yet.",
        }),
      );
    }
    return nodes;
  }
  if (head.group === "reported") {
    // `state` here is the answer the session reported: approved, declined or
    // answered — never the bare word, always in the sentence.
    nodes.push(
      el("p", {
        attrs: { class: "card-state" },
        children: [
          text(
            `The ${head.project} session reports you ${head.state} this on ${calendarDate(head.at)}.`,
          ),
        ],
      }),
      el("small", {
        attrs: { class: "card-small" },
        text: "Reported by a session, not signed by you.",
      }),
    );
    return nodes;
  }
  // group === "closed"
  const action = CLOSED_ACTION[head.state];
  nodes.push(
    el("p", {
      attrs: { class: "card-state" },
      children: [
        text(
          `The ${head.project} session ${action} on ${calendarDate(head.at)}.`,
        ),
      ],
    }),
  );
  if (head.coveredAnswer) {
    const cover = head.coveredAnswer;
    const withWords = cover.words ? `: "${cover.words}"` : "";
    nodes.push(
      el("p", {
        attrs: { class: "card-covered" },
        text: `It had been reported that you ${cover.state}${withWords}.`,
      }),
    );
  }
  return nodes;
}

/**
 * One decision card, in the order the brief lists: the door band, the question,
 * the facts, the state line, then the four optional notes — earlier answer,
 * act-elsewhere, the `from` instruction, and the id line at the bottom.
 */
function card(head, nowMs) {
  const children = [];
  const band = doorBand(head);
  if (band !== undefined) {
    children.push(el("div", { attrs: { class: "door-band" }, text: band }));
  }
  children.push(
    el("p", { attrs: { class: "card-question" }, text: head.question }),
    el("p", { attrs: { class: "card-facts" }, text: factsLine(head) }),
    ...stateNodes(head),
  );
  if (head.earlierAnswer) {
    const ear = head.earlierAnswer;
    const withWords = ear.words ? `: "${ear.words}"` : "";
    children.push(
      el("p", {
        attrs: { class: "card-earlier" },
        text: `An earlier text of this decision was answered: ${ear.state}${withWords}. That answer does not apply to the current text.`,
      }),
    );
  }
  if (head.actElsewhere) {
    children.push(
      el("p", {
        attrs: { class: "card-elsewhere" },
        text: `Cannot be answered here. Act in: ${head.actElsewhere.where}: ${head.actElsewhere.what}.`,
      }),
    );
  }
  if (head.from) {
    children.push(
      el("p", {
        attrs: { class: "card-from" },
        text: `From ${head.from}: a standing instruction that applies to this project.`,
      }),
    );
  }
  children.push(
    el("p", {
      attrs: { class: "card-meta" },
      children: [text(head.id), text(" · "), stamp(head.at, nowMs)],
    }),
  );
  return el("li", { attrs: { class: "inbox-card" }, children });
}

/**
 * One group of cards under its heading, or nothing when the group is empty: a
 * blank heading is a heading that promises cards the next redraw might not bring,
 * and a reader looking for "Reported as answered" and finding it absent knows
 * that none was reported.
 */
function groupBlock(label, cls, heads, nowMs) {
  if (heads.length === 0) {
    return undefined;
  }
  return el("section", {
    attrs: { class: `inbox-group ${cls}` },
    children: [
      el("h3", { text: label }),
      el("ul", {
        attrs: { class: "inbox-cards" },
        children: heads.map((head) => card(head, nowMs)),
      }),
    ],
  });
}

/**
 * One project's block: its name as a link, its own counts in the same wording as
 * the totals, and then its cards under the three sub-headings. A project with
 * nothing listed is one line — name and "nothing waiting" — so the eye skips it
 * without reading a block of zeros.
 */
function projectBlock(project, nowMs) {
  const hasDecisions =
    project.waiting.length + project.reported.length + project.closed.length >
    0;
  if (!hasDecisions) {
    return el("p", {
      attrs: { class: "inbox-empty" },
      children: [
        internalLink(project.name, `/p/${project.id}`),
        text(` · ${EMPTY}`),
      ],
    });
  }
  return el("section", {
    attrs: { class: "inbox-project" },
    children: [
      el("h2", {
        children: [internalLink(project.name, `/p/${project.id}`)],
      }),
      el("p", {
        attrs: { class: "inbox-counts" },
        text: countLine(project.counts),
      }),
      groupBlock(GROUP_HEAD.waiting, "inbox-waiting", project.waiting, nowMs),
      groupBlock(
        GROUP_HEAD.reported,
        "inbox-reported",
        project.reported,
        nowMs,
      ),
      groupBlock(GROUP_HEAD.closed, "inbox-closed", project.closed, nowMs),
    ].filter((child) => child !== undefined),
  });
}

/**
 * The whole page: the heading, the totals, one block per project, and the
 * footer that says what the page cannot do — always, even when the inbox is
 * empty, so the rule is above the fold as well as named.
 */
export function renderInbox(model, nowMs) {
  return el("section", {
    attrs: { class: "view inbox" },
    children: [
      el("h1", { text: HEADING }),
      el("p", {
        attrs: { class: "inbox-totals" },
        text: countLine(model.totals),
      }),
      ...model.projects.map((project) => projectBlock(project, nowMs)),
      el("p", { attrs: { class: "inbox-footer" }, text: FOOTER }),
    ],
  });
}
