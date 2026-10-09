/**
 * Three pure builders for the decision page, each taking the checked model and
 * returning DOM nodes or `undefined` when the section does not apply. They are
 * split out from the main view so each can be tested on its own exact text, and
 * so the view that assembles them stays short.
 *
 * The model is already past `drawableDecision`, so every field below is one the
 * page can draw: ids are the ones the URL asked for, hashes and counts agree,
 * and an entry's revision is one the response carried. The builders assemble
 * text from those parts only.
 */

import { el, internalLink, text, httpsUrl } from "../dom.js";

const OPTIONS_HEADING = "Options";
const NO_RECOMMENDATION = "No recommendation given.";
const COMMITS_HEADING = "Approving this commits you to";
const EVIDENCE_HEADING = "Evidence";
const ACT_HEADING = "What you would do";
const APPLIES_HEADING = "Applies to";

/** One option as the page reads it: "key: text — Cost: cost". */
function optionLine(option) {
  return `${option.key}: ${option.text} — Cost: ${option.cost}`;
}

/**
 * One option in the list. The recommended option carries the word "Recommended"
 * beside it and, under it, "Why: " plus the reason.
 */
function optionItem(option, recommended, recommendedReason) {
  const children = [text(optionLine(option))];
  if (recommended) {
    children.push(
      el("span", { attrs: { class: "recommended" }, text: " Recommended" }),
      el("small", {
        attrs: { class: "card-small" },
        text: ` Why: ${recommendedReason}`,
      }),
    );
  }
  return el("li", { attrs: { class: "option" }, children });
}

/**
 * The options for a `choice`: the heading, each option, the recommended one
 * marked, and "No recommendation given." when the decision has none.
 */
function choiceBlock(decision) {
  const recommendedKey = decision.recommended?.option;
  return el("section", {
    attrs: { class: "decision-options" },
    children: [
      el("h2", { text: OPTIONS_HEADING }),
      el("ul", {
        attrs: { class: "options" },
        children: decision.options.map((opt) =>
          optionItem(
            opt,
            opt.key === recommendedKey,
            decision.recommended?.reason,
          ),
        ),
      }),
      ...(decision.recommended === undefined
        ? [
            el("p", {
              attrs: { class: "no-recommendation" },
              text: NO_RECOMMENDATION,
            }),
          ]
        : []),
    ],
  });
}

/**
 * The `action` block: the heading and the act-elsewhere line the page shows the
 * reader where to act.
 */
function actionBlock(decision) {
  return el("section", {
    attrs: { class: "decision-action" },
    children: [
      el("h2", { text: ACT_HEADING }),
      el("p", {
        attrs: { class: "card-elsewhere" },
        text: `Cannot be answered here. Act in: ${decision.actElsewhere.where}: ${decision.actElsewhere.what}.`,
      }),
    ],
  });
}

/**
 * The `instruction` block: the heading and the project ids each as a link to its
 * own page, since an instruction that applies to another project is read there.
 */
function instructionBlock(decision) {
  return el("section", {
    attrs: { class: "decision-applies-to" },
    children: [
      el("h2", { text: APPLIES_HEADING }),
      el("ul", {
        attrs: { class: "applies-to" },
        children: decision.appliesTo.map((id) =>
          el("li", { children: [internalLink(id, `/p/${id}`)] }),
        ),
      }),
    ],
  });
}

/**
 * The options block for any shape: the right heading and content for a choice,
 * an action, or an instruction. `undefined` for no options at all, which does not
 * happen for these three shapes.
 */
export function optionsBlock(model) {
  const decision = model.currentRevision.decision;
  if (decision.shape === "choice") {
    return choiceBlock(decision);
  }
  if (decision.shape === "action") {
    return actionBlock(decision);
  }
  return instructionBlock(decision);
}

/** The commitments, only when there are any, one item per commitment. */
export function commitmentsBlock(model) {
  const commits = model.currentRevision.decision.commits;
  if (commits.length === 0) {
    return undefined;
  }
  return el("section", {
    attrs: { class: "decision-commits" },
    children: [
      el("h2", { text: COMMITS_HEADING }),
      el("ul", {
        attrs: { class: "commits" },
        children: commits.map((commit) =>
          el("li", { attrs: { class: "commit" }, text: commit }),
        ),
      }),
    ],
  });
}

/** A link to an evidence source, or its label as text when not https. */
function evidenceLink(label, href) {
  const url = httpsUrl(href);
  if (url === undefined) {
    return text(label);
  }
  const node = el("a", {
    attrs: { class: "link", rel: "noreferrer noopener" },
    text: label,
  });
  node.setAttribute("href", url);
  node.setAttribute("target", "_blank");
  return node;
}

/** The references as plain text, joined in the order the page reads them. */
function refsText(refs) {
  const parts = [];
  if (refs.wave !== undefined) {
    parts.push(`wave ${refs.wave}`);
  }
  if (refs.lane !== undefined) {
    parts.push(`lane ${refs.lane}`);
  }
  if (refs.pr !== undefined) {
    parts.push(`PR #${refs.pr}`);
  }
  return parts.join(" · ");
}

/**
 * The evidence section: links for each source, followed by the references as
 * plain text, only when at least one of them is present.
 */
export function evidenceBlock(model) {
  const decision = model.currentRevision.decision;
  const hasEvidence = decision.evidence.length > 0;
  const hasRefs = decision.refs !== undefined && decision.refs !== null;
  if (!hasEvidence && !hasRefs) {
    return undefined;
  }
  const children = [];
  if (hasEvidence) {
    children.push(
      el("h2", { text: EVIDENCE_HEADING }),
      el("ul", {
        attrs: { class: "evidence" },
        children: decision.evidence.map((link) =>
          el("li", { children: [evidenceLink(link.label, link.href)] }),
        ),
      }),
    );
  }
  if (hasRefs) {
    children.push(
      el("p", {
        attrs: { class: "decision-refs" },
        text: refsText(decision.refs),
      }),
    );
  }
  return el("section", { attrs: { class: "decision-evidence" }, children });
}
