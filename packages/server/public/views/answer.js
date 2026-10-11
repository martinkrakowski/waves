/**
 * The answer controls on a decision's page, as a pure view: it is handed a
 * model past `drawableDecision` and a small state object, it returns DOM, and
 * every press it draws calls a handler it was given. No fetch, no navigator,
 * no timers, no module state — the logic lane (`answer.js`) owns all of that
 * and hands this view the state to draw.
 *
 * The confirmation repeats the full text the reader is about to sign — the
 * question, the options, the commitments — so a reflex press signs nothing
 * he has not read (design `docs/planning/2026-10-08_decisions-inbox.md` 6.2
 * step 3). Every string from the model or the state reaches the page as a
 * text node, never as HTML.
 */

import { el } from "../dom.js";
import { optionsBlock, commitmentsBlock } from "./decision-parts.js";

/** The line the page puts under the answer controls, wherever it draws them. */
export const ANSWER_FOOTER =
  "An answer given here is signed with your passkey. A session acts on it only after checking the signature itself.";

/** The textarea's id, so the page can put the caret back after a redraw. */
export const WORDS_ID = "answer-words";

const HEADING = "Your answer";
const CLOSED_NOTE =
  "This is marked hard to undo, so it cannot be answered in the page. Answer in the terminal, in the session that asked.";

/** One sentence per outcome the answer flow can end in, by its kind. */
const OUTCOME_TEXT = {
  stored: "Signed and recorded.",
  moved:
    "This decision changed while you were answering. Nothing was recorded. Read it again before you answer.",
  off: "Answering in the page is not switched on.",
  busy: "Too many tries. Wait a moment and try again.",
  cancelled:
    "The passkey prompt was cancelled or timed out. Nothing was signed.",
  "not-verified":
    "The server did not accept the signature. Nothing was recorded.",
  "text-mismatch":
    "The text on this page does not match the server's record of it. Nothing was signed. Reload the page.",
  "in-progress":
    "A passkey prompt from an earlier press is still open. Finish or cancel it first.",
};

/** A refusal's sentence, by the reason the server refused for. */
const REFUSED_TEXT = {
  "one-way-door":
    "This is marked hard to undo, so it cannot be answered in the page.",
  "act-elsewhere": "This cannot be answered here.",
  "signed-cap": "This decision cannot take another answer.",
  "entry-ceiling": "This decision cannot take another answer.",
};

const TRY_AGAIN = "The answer was not recorded. Try again.";

const WORDS_LABEL = "Your answer, in your own words";
const EMPTY_PROBLEM = "Write your answer first.";
const TOO_LONG_PROBLEM = "That is too long to sign.";

const CONFIRM_LEAD = "You are about to sign this answer with your passkey.";
const WORKING = "Waiting for your passkey…";

/**
 * The note that replaces the controls for a decision this page cannot answer.
 * Only `one-way-door` has one; every other reason is the state's to word.
 */
export function notAnswerableNote(reason) {
  if (reason !== "one-way-door") {
    return undefined;
  }
  return el("p", { attrs: { class: "answer-closed" }, text: CLOSED_NOTE });
}

/** The sentence for an outcome the answer flow ended in. */
export function outcomeMessage(outcome) {
  if (Object.hasOwn(OUTCOME_TEXT, outcome.kind)) {
    return OUTCOME_TEXT[outcome.kind];
  }
  if (outcome.kind === "refused") {
    return Object.hasOwn(REFUSED_TEXT, outcome.reason)
      ? REFUSED_TEXT[outcome.reason]
      : TRY_AGAIN;
  }
  return TRY_AGAIN;
}

/**
 * A button the page owns: never a submit, and pressable until it is not. The
 * `data-key` is the app's own handle on it, so a redraw puts the focus back
 * on the same button and never drops a keyboard reader out of the flow.
 */
function button(label, dataKey, onClick, disabled = false) {
  const node = el("button", {
    attrs: { class: "answer-button", type: "button", "data-key": dataKey },
    text: label,
  });
  if (disabled) {
    node.setAttribute("disabled", "disabled");
  }
  node.addEventListener("click", onClick);
  return node;
}

/** The buttons in one row, which wraps on a screen narrower than they are. */
function buttonRow(buttons) {
  return el("div", { attrs: { class: "answer-buttons" }, children: buttons });
}

/** A status line the reader is told without the page moving. */
function statusLine(classWord, message) {
  return el("p", {
    attrs: { class: classWord, role: "status", "aria-live": "polite" },
    text: message,
  });
}

/** The idle controls: the outcome of the last try above the three choices. */
function idleChildren(ui, handlers) {
  const children = [];
  if (typeof ui.message === "string" && ui.message !== "") {
    children.push(statusLine("answer-message", ui.message));
  }
  children.push(
    buttonRow([
      button("Yes", "answer-yes", handlers.onYes),
      button("No", "answer-no", handlers.onNo),
      button("Answer in my own words", "answer-words-open", handlers.onWords),
    ]),
  );
  return children;
}

/** The own-words controls: the draft, the problem with it, and the two ways on. */
function wordsChildren(ui, handlers) {
  const area = el("textarea", {
    attrs: {
      class: "answer-words",
      id: WORDS_ID,
      "data-key": "answer-words",
    },
  });
  area.setAttribute("rows", "4");
  area.setAttribute("maxlength", String(handlers.maxWords));
  area.value = ui.draft;
  area.addEventListener("input", (event) => {
    handlers.onDraft(event.target.value);
  });
  const children = [
    el("label", { attrs: { for: WORDS_ID }, text: WORDS_LABEL }),
    area,
  ];
  if (ui.problem === "empty") {
    children.push(
      el("p", { attrs: { class: "answer-problem" }, text: EMPTY_PROBLEM }),
    );
  } else if (ui.problem === "too-long") {
    children.push(
      el("p", { attrs: { class: "answer-problem" }, text: TOO_LONG_PROBLEM }),
    );
  }
  children.push(
    buttonRow([
      button("Continue", "answer-continue", handlers.onContinue),
      button("Cancel", "answer-cancel", handlers.onCancel),
    ]),
  );
  return children;
}

/** The verdict line, and for own words the words themselves beside it. */
function verdictChildren(choice) {
  if (choice.verdict === "approved") {
    return [
      el("p", {
        attrs: { class: "answer-confirm-verdict" },
        text: "Your answer: Yes (approved)",
      }),
    ];
  }
  if (choice.verdict === "declined") {
    return [
      el("p", {
        attrs: { class: "answer-confirm-verdict" },
        text: "Your answer: No (declined)",
      }),
    ];
  }
  return [
    el("p", {
      attrs: { class: "answer-confirm-verdict" },
      text: "Your answer, in your own words:",
    }),
    // One text node, so the words keep their white space exactly as typed.
    el("blockquote", {
      attrs: { class: "answer-confirm-words" },
      text: choice.words,
    }),
  ];
}

/**
 * The confirmation band: the full text he is about to sign — the same option
 * and commitment blocks the page shows above — then his answer on it, the
 * facts of the entry it will become, and the two buttons that end the flow.
 */
function confirmChildren(model, choice, handlers, working) {
  const children = [
    el("p", { attrs: { class: "answer-confirm-lead" }, text: CONFIRM_LEAD }),
    el("p", {
      attrs: { class: "answer-confirm-question" },
      text: model.currentRevision.decision.question,
    }),
    optionsBlock(model),
  ];
  const commits = commitmentsBlock(model);
  if (commits !== undefined) {
    children.push(commits);
  }
  children.push(...verdictChildren(choice));
  children.push(
    el("p", {
      attrs: { class: "answer-confirm-facts" },
      text: `Revision ${model.currentRevision.revision} · this will be entry ${model.currentEntries.length + model.earlierEntries.length + 1} on this decision`,
    }),
    buttonRow([
      button("Sign with your passkey", "answer-sign", handlers.onSign, working),
      button("Cancel", "answer-cancel", handlers.onCancel, working),
    ]),
  );
  if (working) {
    children.push(statusLine("answer-working", WORKING));
  }
  return children;
}

/**
 * Draws the answer controls from the state the logic lane holds. `ui.kind` is
 * the step the flow is on: `idle` offers the three choices, `words` edits the
 * draft, `confirm` repeats the text he is about to sign, and `working` is the
 * same confirmation with both buttons held back until the passkey prompt ends.
 * Any other kind is not a step this view knows, so it throws rather than draw
 * half a flow.
 */
export function answerSection(model, ui, handlers) {
  const children = [el("h2", { text: HEADING })];
  if (ui.kind === "idle") {
    children.push(...idleChildren(ui, handlers));
  } else if (ui.kind === "words") {
    children.push(...wordsChildren(ui, handlers));
  } else if (ui.kind === "confirm" || ui.kind === "working") {
    children.push(
      el("div", {
        attrs: { class: "answer-confirm" },
        children: confirmChildren(
          model,
          ui.choice,
          handlers,
          ui.kind === "working",
        ),
      }),
    );
  } else {
    throw new TypeError(`refusing to draw an answer state of kind ${ui.kind}`);
  }
  return el("section", { attrs: { class: "answer" }, children });
}
