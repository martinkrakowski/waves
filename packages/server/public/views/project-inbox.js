/**
 * The page for one project's decisions at `/p/<project>/inbox`: the project's
 * own four counts and its decisions in the inbox's three groups, plus the
 * standing instructions other projects raise against it (marked `from`). It
 * reuses the inbox's card, group block and count line so the two pages read the
 * same way — including a `from` card, whose link already goes to the raising
 * project, because a `from` head carries the raiser as its own `project`.
 *
 * History heads — decisions that left the inbox after fourteen days — are not
 * drawn as cards; a single line counts them instead. A project with nothing in
 * any of the three groups gets one line saying so. The page takes no answers:
 * no button, input or form.
 */

import { countLine } from "./inbox-model.js";
import { GROUP_HEAD, FOOTER, groupBlock } from "./inbox.js";
import { el, internalLink, text } from "../dom.js";

/** The line shown for a project whose three drawn groups are all empty. */
const EMPTY = "Nothing is waiting on you in this project.";

/**
 * Decisions split into the four groups the inbox check allows: the three the
 * view draws, and `history`, which it does not. The server already sorted them
 * this way; this is a partition, not a re-sort, so a card the reader is looking
 * for does not jump past its neighbour.
 */
function groupHeads(decisions) {
  return decisions.reduce(
    (byGroup, head) => {
      byGroup[head.group].push(head);
      return byGroup;
    },
    { waiting: [], reported: [], closed: [], history: [] },
  );
}

/** "Inbox · <project>": the path back from the all-projects inbox. */
function breadcrumbs(view) {
  return el("nav", {
    attrs: { class: "project-inbox-breadcrumbs" },
    children: [
      internalLink("Inbox", "/inbox"),
      text(" · "),
      internalLink(view.project.name, `/p/${view.project.id}`),
    ],
  });
}

/** The line that counts the history heads this page does not draw, singular-aware. */
function historyLine(historyCount) {
  const noun = historyCount === 1 ? "decision" : "decisions";
  return el("p", {
    attrs: { class: "project-inbox-history" },
    text: `${historyCount} ${noun} left the inbox after 14 days.`,
  });
}

/**
 * The whole page: the breadcrumb, the heading, the project's own counts, the
 * three groups of cards, the history line when there is one, the empty line when
 * there is nothing to draw, and the inbox's footer sentence — always, even when
 * the inbox is empty, so the rule sits above the fold as well as named.
 */
export function renderProjectInbox(view, nowMs) {
  const groups = groupHeads(view.decisions);
  const inGroups =
    groups.waiting.length + groups.reported.length + groups.closed.length;
  const children = [
    breadcrumbs(view),
    el("h1", { text: `${view.project.name} · decisions` }),
    el("p", {
      attrs: { class: "inbox-counts" },
      text: countLine(view.counts),
    }),
    groupBlock(GROUP_HEAD.waiting, "inbox-waiting", groups.waiting, nowMs),
    groupBlock(GROUP_HEAD.reported, "inbox-reported", groups.reported, nowMs),
    groupBlock(GROUP_HEAD.closed, "inbox-closed", groups.closed, nowMs),
  ];
  if (groups.history.length > 0) {
    children.push(historyLine(groups.history.length));
  }
  if (inGroups === 0) {
    children.push(
      el("p", { attrs: { class: "project-inbox-empty" }, text: EMPTY }),
    );
  }
  children.push(el("p", { attrs: { class: "inbox-footer" }, text: FOOTER }));
  return el("section", {
    attrs: { class: "view project-inbox" },
    children: children.filter((child) => child !== undefined),
  });
}
