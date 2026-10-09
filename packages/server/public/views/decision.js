/**
 * The decision page: one decision, read-only, in full. It is given a model from
 * `decision-model.js` — already past `drawableDecision` — and assembles the
 * breadcrumb, the door band and state nodes from the inbox view, the option,
 * commitment and evidence blocks, the act-elsewhere line, the history timeline,
 * the earlier texts, and the footer that says what the page does not do.
 *
 * No button, input, select, textarea or form on this page. A decision is read
 * here and answered in the session that asked, and the word for that is at the
 * foot, not in a control.
 */

import { SHAPE_WORD, DECIDER_WORD, doorBand, stateNodes } from "./inbox.js";
import { calendarDate } from "../format.js";
import { el, internalLink, text } from "../dom.js";
import {
  optionsBlock,
  commitmentsBlock,
  evidenceBlock,
} from "./decision-parts.js";
import { historyBlock, earlierTextsBlock } from "./decision-history.js";

/**
 * The state a history decision left: answered states were "reported", the two
 * closing states were "closed", and open or delegated were "waiting". The page
 * re-uses `stateNodes` by setting the head's group to the one it left, so the
 * sentence is the one the inbox would have used.
 */
const LEFT_GROUP = {
  open: "waiting",
  delegated: "waiting",
  approved: "reported",
  declined: "reported",
  answered: "reported",
  withdrawn: "closed",
  superseded: "closed",
};

const FOOTER =
  "This page shows a decision; it does not take an answer. Answer in the terminal, in the session that asked.";

/** "Inbox · <project>": the path from the inbox to this project. */
function breadcrumbs(model) {
  const project = model.head.project;
  return el("nav", {
    attrs: { class: "decision-breadcrumbs" },
    children: [
      internalLink("Inbox", "/inbox"),
      text(" · "),
      internalLink(project, `/p/${project}`),
    ],
  });
}

/** shape in a word, who decides, revision N of M, raised by on <date>. */
function factsLine(model) {
  const head = model.head;
  const decision = model.currentRevision.decision;
  return [
    SHAPE_WORD[head.shape],
    DECIDER_WORD[head.decider],
    `revision ${head.revision} of ${head.revisions}`,
    `raised by ${decision.raisedBy} on ${calendarDate(decision.raisedAt)}`,
  ].join(" · ");
}

/**
 * The state the head carries, by its group. For "history", the page shows the
 * sentence the group it left would have used, then says how long it has been
 * gone.
 */
function stateSection(model) {
  const head = model.head;
  if (head.group === "history") {
    const left = LEFT_GROUP[head.state];
    const nodes = stateNodes({ ...head, group: left });
    nodes.push(
      el("small", {
        attrs: { class: "card-small" },
        text: "This left the inbox after 14 days.",
      }),
    );
    return nodes;
  }
  return stateNodes(head);
}

/**
 * Assembles the whole page from the model and its sub-builders. Each section is
 * pushed onto the children array only when its builder returns a node, so a
 * page with no commitments or no evidence leaves no empty heading behind.
 */
export function renderDecision(model) {
  const head = model.head;
  const decision = model.currentRevision.decision;
  const children = [breadcrumbs(model)];

  const band = doorBand(head);
  if (band !== undefined) {
    children.push(el("div", { attrs: { class: "door-band" }, text: band }));
  }

  children.push(
    el("h1", {
      attrs: { class: "decision-question" },
      text: decision.question,
    }),
    el("p", {
      attrs: { class: "decision-facts" },
      text: factsLine(model),
    }),
  );

  children.push(...stateSection(model));

  const opts = optionsBlock(model);
  if (opts !== undefined) {
    children.push(opts);
  }

  const commits = commitmentsBlock(model);
  if (commits !== undefined) {
    children.push(commits);
  }

  // act-elsewhere for shapes that are not action: action shows its line in the
  // options block above.
  if (decision.actElsewhere !== undefined && decision.shape !== "action") {
    children.push(
      el("p", {
        attrs: { class: "card-elsewhere" },
        text: `Cannot be answered here. Act in: ${decision.actElsewhere.where}: ${decision.actElsewhere.what}.`,
      }),
    );
  }

  const evidence = evidenceBlock(model);
  if (evidence !== undefined) {
    children.push(evidence);
  }

  children.push(historyBlock(model));

  const earlier = earlierTextsBlock(model);
  if (earlier !== undefined) {
    children.push(earlier);
  }

  children.push(el("p", { attrs: { class: "decision-footer" }, text: FOOTER }));

  return el("section", {
    attrs: { class: "view decision" },
    children,
  });
}
