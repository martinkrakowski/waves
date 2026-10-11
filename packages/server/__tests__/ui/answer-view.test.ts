import { describe, expect, it, vi } from "vitest";

import type { AnswerHandlers, AnswerUi } from "../../public/views/answer.js";
import {
  ANSWER_FOOTER,
  WORDS_ID,
  answerSection,
  notAnswerableNote,
  outcomeMessage,
} from "../../public/views/answer.js";
import { decisionModel } from "../../public/views/decision-model.js";

import {
  decisionEntry,
  decisionResponse,
  decisionRevision,
  storedRevision,
} from "./fixtures.js";
import {
  assertNoInjectedMarkup,
  freshRoot,
  textOf,
  textsOf,
} from "./helpers.js";

const IMG = "<img src=x onerror=alert(1)>";

/** A hash no revision carries, so an entry with it belongs to an earlier text. */
const EARLIER_HASH = "f".repeat(64);

/**
 * The handlers the view calls, as counters: a test presses a control and reads
 * which of them heard it. `maxWords` is the cap the draft is held to.
 */
function stubHandlers(): AnswerHandlers {
  return {
    onYes: vi.fn(),
    onNo: vi.fn(),
    onWords: vi.fn(),
    onDraft: vi.fn(),
    onContinue: vi.fn(),
    onCancel: vi.fn(),
    onSign: vi.fn(),
    maxWords: 280,
  };
}

/** The model the answer controls are drawn over: `Go?` with two options. */
function answerModel(entries = 0): ReturnType<typeof decisionModel> {
  return decisionModel(
    decisionResponse({
      entries: Array.from({ length: entries }, (_unused, i) =>
        decisionEntry({ index: i }),
      ),
    }),
  );
}

/** The same model with one commitment, so the confirmation has one to repeat. */
function answerModelWithCommit(): ReturnType<typeof decisionModel> {
  return decisionModel(
    decisionResponse({
      revisions: [
        storedRevision({
          decision: decisionRevision({ commits: ["Ship it"] }),
        }),
      ],
    }),
  );
}

/**
 * Draws the answer controls, asserts the markup invariants and the two things
 * that must hold in every state: no form, and no button that submits one.
 */
function draw(
  ui: AnswerUi,
  model: ReturnType<typeof decisionModel> = answerModel(),
  handlers: AnswerHandlers = stubHandlers(),
): HTMLElement {
  const host = freshRoot();
  host.append(answerSection(model, ui, handlers));
  assertNoInjectedMarkup();
  expect(host.querySelector("form")).toBeNull();
  for (const button of Array.from(host.querySelectorAll("button"))) {
    expect(button.getAttribute("type")).toBe("button");
  }
  return host;
}

/** Every button on the page, in the order a reader meets them. */
function buttonsOf(host: Element): HTMLElement[] {
  return Array.from(host.querySelectorAll("button"));
}

/** The `data-key` of every keyed control, in the order a reader meets them. */
function keysOf(host: Element): string[] {
  return Array.from(host.querySelectorAll("[data-key]"), (element) =>
    element.getAttribute("data-key"),
  );
}

function labelsOf(host: Element): string[] {
  return buttonsOf(host).map((button) => button.textContent ?? "");
}

describe("the constants the wiring lane reads", () => {
  it("owns the footer and the textarea's id", () => {
    expect(ANSWER_FOOTER).toBe(
      "An answer given here is signed with your passkey. A session acts on it only after checking the signature itself.",
    );
    expect(WORDS_ID).toBe("answer-words");
  });
});

describe("notAnswerableNote", () => {
  it("words the note only for a decision marked hard to undo", () => {
    const note = notAnswerableNote("one-way-door");
    expect(note?.className).toBe("answer-closed");
    expect(note?.textContent).toBe(
      "This is marked hard to undo, so it cannot be answered in the page. Answer in the terminal, in the session that asked.",
    );
    for (const reason of ["act-elsewhere", "signed-cap", "anything", ""]) {
      expect(notAnswerableNote(reason)).toBeUndefined();
    }
  });
});

describe("outcomeMessage", () => {
  it("words the sentence for every way the flow can end well or badly", () => {
    expect(outcomeMessage({ kind: "stored" })).toBe("Signed and recorded.");
    expect(outcomeMessage({ kind: "moved" })).toBe(
      "This decision changed while you were answering. Nothing was recorded. Read it again before you answer.",
    );
    expect(outcomeMessage({ kind: "off" })).toBe(
      "Answering in the page is not switched on.",
    );
    expect(outcomeMessage({ kind: "busy" })).toBe(
      "Too many tries. Wait a moment and try again.",
    );
    expect(outcomeMessage({ kind: "cancelled" })).toBe(
      "The passkey prompt was cancelled or timed out. Nothing was signed.",
    );
    expect(outcomeMessage({ kind: "not-verified" })).toBe(
      "The server did not accept the signature. Nothing was recorded.",
    );
    expect(outcomeMessage({ kind: "text-mismatch" })).toBe(
      "The text on this page does not match the server's record of it. Nothing was signed. Reload the page.",
    );
    expect(outcomeMessage({ kind: "not-answerable" })).toBe(
      "The answer was not recorded. Try again.",
    );
    expect(outcomeMessage({ kind: "in-progress" })).toBe(
      "The answer was not recorded. Try again.",
    );
    expect(outcomeMessage({ kind: "failed" })).toBe(
      "The answer was not recorded. Try again.",
    );
  });

  it("words a refusal by the reason the server refused for", () => {
    expect(outcomeMessage({ kind: "refused", reason: "one-way-door" })).toBe(
      "This is marked hard to undo, so it cannot be answered in the page.",
    );
    expect(outcomeMessage({ kind: "refused", reason: "act-elsewhere" })).toBe(
      "This cannot be answered here.",
    );
    expect(outcomeMessage({ kind: "refused", reason: "signed-cap" })).toBe(
      "This decision cannot take another answer.",
    );
    expect(outcomeMessage({ kind: "refused", reason: "entry-ceiling" })).toBe(
      "This decision cannot take another answer.",
    );
  });

  it("says only that nothing was recorded for a reason it does not know", () => {
    expect(outcomeMessage({ kind: "refused", reason: "nope" })).toBe(
      "The answer was not recorded. Try again.",
    );
    expect(outcomeMessage({ kind: "refused" })).toBe(
      "The answer was not recorded. Try again.",
    );
    expect(outcomeMessage({ kind: "strange" } as never)).toBe(
      "The answer was not recorded. Try again.",
    );
  });
});

describe("answerSection: idle", () => {
  it("offers the three choices in order, each calling only its handler", () => {
    const handlers = stubHandlers();
    const host = draw({ kind: "idle" }, answerModel(), handlers);
    expect(textsOf(host, "h2")).toStrictEqual(["Your answer"]);
    expect(labelsOf(host)).toStrictEqual([
      "Yes",
      "No",
      "Answer in my own words",
    ]);
    const [yes, no, words] = buttonsOf(host);
    yes?.click();
    expect(handlers.onYes).toHaveBeenCalledTimes(1);
    expect(handlers.onNo).not.toHaveBeenCalled();
    expect(handlers.onWords).not.toHaveBeenCalled();
    no?.click();
    expect(handlers.onNo).toHaveBeenCalledTimes(1);
    expect(handlers.onYes).toHaveBeenCalledTimes(1);
    words?.click();
    expect(handlers.onWords).toHaveBeenCalledTimes(1);
    expect(handlers.onSign).not.toHaveBeenCalled();
  });

  it("shows the outcome of the last try above the choices when there was one", () => {
    const host = draw({
      kind: "idle",
      message: outcomeMessage({ kind: "stored" }),
    });
    const line = host.querySelector("p.answer-message");
    expect(line?.textContent).toBe("Signed and recorded.");
    expect(line?.getAttribute("role")).toBe("status");
    expect(line?.nextElementSibling?.className).toBe("answer-buttons");
  });

  it("leaves the outcome line out when the last try said nothing", () => {
    for (const message of [undefined, ""] as const) {
      const host = draw(
        message === undefined ? { kind: "idle" } : { kind: "idle", message },
      );
      expect(host.querySelector("p.answer-message")).toBeNull();
    }
  });
});

describe("answerSection: words", () => {
  it("binds the label to the draft and caps the draft at maxWords", () => {
    const host = draw({ kind: "words", draft: "because  of  this" });
    const label = host.querySelector("label");
    expect(label?.getAttribute("for")).toBe(WORDS_ID);
    expect(label?.textContent).toBe("Your answer, in your own words");
    const area = host.querySelector(`#${WORDS_ID}`) as HTMLTextAreaElement;
    expect(area.value).toBe("because  of  this");
    expect(area.getAttribute("rows")).toBe("4");
    expect(area.getAttribute("maxlength")).toBe("280");
  });

  it("hands the new draft to onDraft on every input", () => {
    const handlers = stubHandlers();
    const host = draw({ kind: "words", draft: "" }, answerModel(), handlers);
    const area = host.querySelector(`#${WORDS_ID}`) as HTMLTextAreaElement;
    area.value = "a new draft";
    area.dispatchEvent(new Event("input"));
    expect(handlers.onDraft).toHaveBeenCalledTimes(1);
    expect(handlers.onDraft).toHaveBeenCalledWith("a new draft");
    expect(handlers.onContinue).not.toHaveBeenCalled();
  });

  it("says why a draft cannot be signed as it stands", () => {
    const empty = draw({ kind: "words", draft: "", problem: "empty" });
    expect(textOf(empty.querySelector("p.answer-problem"))).toBe(
      "Write your answer first.",
    );
    const tooLong = draw({
      kind: "words",
      draft: "x".repeat(281),
      problem: "too-long",
    });
    expect(textOf(tooLong.querySelector("p.answer-problem"))).toBe(
      "That is too long to sign.",
    );
    expect(
      draw({ kind: "words", draft: "fine" }).querySelector("p.answer-problem"),
    ).toBeNull();
  });

  it("offers the two ways on, in order, each calling only its handler", () => {
    const handlers = stubHandlers();
    const host = draw(
      { kind: "words", draft: "fine" },
      answerModel(),
      handlers,
    );
    expect(labelsOf(host)).toStrictEqual(["Continue", "Cancel"]);
    const [on, off] = buttonsOf(host);
    on?.click();
    expect(handlers.onContinue).toHaveBeenCalledTimes(1);
    expect(handlers.onCancel).not.toHaveBeenCalled();
    off?.click();
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
    expect(handlers.onYes).not.toHaveBeenCalled();
  });
});

describe("answerSection: the keys the focus logic reads", () => {
  it("carries a data-key on every control, in every step of the flow", () => {
    // The keys are the app's own handles: a redraw puts the focus back on the
    // same control, and the textarea's caret with it, so a keyboard reader is
    // never dropped out of the flow by the ten-second refresh.
    expect(keysOf(draw({ kind: "idle" }))).toStrictEqual([
      "answer-yes",
      "answer-no",
      "answer-words-open",
    ]);
    expect(keysOf(draw({ kind: "words", draft: "" }))).toStrictEqual([
      "answer-words",
      "answer-continue",
      "answer-cancel",
    ]);
    expect(
      keysOf(draw({ kind: "confirm", choice: { verdict: "approved" } })),
    ).toStrictEqual(["answer-sign", "answer-cancel"]);
    expect(
      keysOf(draw({ kind: "working", choice: { verdict: "approved" } })),
    ).toStrictEqual(["answer-sign", "answer-cancel"]);
  });
});

describe("answerSection: confirm", () => {
  it("repeats the full text he is about to sign, then the verdict and the facts", () => {
    const host = draw(
      { kind: "confirm", choice: { verdict: "approved" } },
      answerModelWithCommit(),
    );
    const band = host.querySelector("div.answer-confirm") as HTMLElement;
    expect(
      Array.from(band.children).map((child) => child.getAttribute("class")),
    ).toStrictEqual([
      "answer-confirm-lead",
      "answer-confirm-question",
      "decision-options",
      "decision-commits",
      "answer-confirm-verdict",
      "answer-confirm-facts",
      "answer-buttons",
    ]);
    expect(textOf(band.querySelector(".answer-confirm-lead"))).toBe(
      "You are about to sign this answer with your passkey.",
    );
    expect(textOf(band.querySelector(".answer-confirm-question"))).toBe("Go?");
    expect(textsOf(band, ".option-head")).toStrictEqual(["a: Yes", "b: No"]);
    expect(textsOf(band, ".option-cost")).toStrictEqual([
      "Cost: C1",
      "Cost: C2",
    ]);
    expect(textsOf(band, ".commits li")).toStrictEqual(["Ship it"]);
    expect(textOf(band.querySelector(".answer-confirm-verdict"))).toBe(
      "Your answer: Yes (approved)",
    );
    expect(textOf(band.querySelector(".answer-confirm-facts"))).toBe(
      "Revision 1 · this will be entry 1 on this decision",
    );
    expect(labelsOf(band)).toStrictEqual(["Sign with your passkey", "Cancel"]);
  });

  it("leaves the commitments out of the band when there are none", () => {
    const host = draw({ kind: "confirm", choice: { verdict: "declined" } });
    expect(host.querySelector(".answer-confirm .decision-commits")).toBeNull();
    expect(textOf(host.querySelector(".answer-confirm-verdict"))).toBe(
      "Your answer: No (declined)",
    );
  });

  it("numbers the entry the answer will become, counting the earlier texts too", () => {
    const earlier = decisionEntry({ textSha256: EARLIER_HASH });
    const model = decisionModel(
      decisionResponse({
        entries: [
          earlier,
          decisionEntry({ index: 1 }),
          decisionEntry({ index: 2 }),
        ],
      }),
    );
    const host = draw(
      { kind: "confirm", choice: { verdict: "approved" } },
      model,
    );
    expect(textOf(host.querySelector(".answer-confirm-facts"))).toBe(
      "Revision 1 · this will be entry 4 on this decision",
    );
  });

  it("shows his own words as one text node, exactly as he typed them", () => {
    const words = "line one\nand  two  spaces";
    const host = draw({
      kind: "confirm",
      choice: { verdict: "answered", words },
    });
    const quote = host.querySelector("blockquote.answer-confirm-words");
    expect(quote).not.toBeNull();
    expect(quote?.childNodes).toHaveLength(1);
    expect(quote?.childNodes[0]?.nodeType).toBe(Node.TEXT_NODE);
    expect(quote?.textContent).toBe(words);
    expect(textOf(host.querySelector(".answer-confirm-verdict"))).toBe(
      "Your answer, in your own words:",
    );
    expect(
      Array.from(
        (host.querySelector(".answer-confirm") as HTMLElement).children,
      ).map((child) => child.getAttribute("class")),
    ).toStrictEqual([
      "answer-confirm-lead",
      "answer-confirm-question",
      "decision-options",
      "answer-confirm-verdict",
      "answer-confirm-words",
      "answer-confirm-facts",
      "answer-buttons",
    ]);
  });

  it("signs and cancels through the handlers it was given", () => {
    const handlers = stubHandlers();
    const host = draw(
      { kind: "confirm", choice: { verdict: "approved" } },
      answerModel(),
      handlers,
    );
    const [sign, cancel] = buttonsOf(host);
    expect(sign?.hasAttribute("disabled")).toBe(false);
    expect(cancel?.hasAttribute("disabled")).toBe(false);
    expect(host.querySelector("p.answer-working")).toBeNull();
    sign?.click();
    expect(handlers.onSign).toHaveBeenCalledTimes(1);
    expect(handlers.onCancel).not.toHaveBeenCalled();
    cancel?.click();
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
    expect(handlers.onYes).not.toHaveBeenCalled();
  });
});

describe("answerSection: working", () => {
  it("holds both buttons back and says what it is waiting for", () => {
    const handlers = stubHandlers();
    const host = draw(
      { kind: "working", choice: { verdict: "approved" } },
      answerModel(),
      handlers,
    );
    const [sign, cancel] = buttonsOf(host);
    expect(sign?.hasAttribute("disabled")).toBe(true);
    expect(cancel?.hasAttribute("disabled")).toBe(true);
    sign?.click();
    cancel?.click();
    expect(handlers.onSign).not.toHaveBeenCalled();
    expect(handlers.onCancel).not.toHaveBeenCalled();
    const line = host.querySelector("p.answer-working");
    expect(line?.textContent).toBe("Waiting for your passkey…");
    expect(line?.getAttribute("role")).toBe("status");
  });
});

describe("answerSection against stored markup", () => {
  it("shows a hostile question, option, commitment and words as text", () => {
    const model = decisionModel(
      decisionResponse({
        revisions: [
          storedRevision({
            decision: decisionRevision({
              question: IMG,
              options: [
                { key: "a", text: IMG, cost: "C1" },
                { key: "b", text: "No", cost: "C2" },
              ],
              commits: [IMG],
            }),
          }),
        ],
      }),
    );
    const host = draw(
      { kind: "confirm", choice: { verdict: "answered", words: IMG } },
      model,
    );
    expect(host.querySelectorAll("img")).toHaveLength(0);
    expect(host.querySelectorAll("script")).toHaveLength(0);
    expect(textOf(host.querySelector(".answer-confirm-question"))).toBe(IMG);
    expect(textsOf(host, ".option-head")).toStrictEqual([`a: ${IMG}`, "b: No"]);
    expect(textsOf(host, ".commits li")).toStrictEqual([IMG]);
    expect(textOf(host.querySelector("blockquote.answer-confirm-words"))).toBe(
      IMG,
    );
  });
});

describe("answerSection against a state it cannot draw", () => {
  it("refuses an unknown kind rather than draw half a flow", () => {
    expect(() =>
      answerSection(
        answerModel(),
        { kind: "bogus" } as unknown as AnswerUi,
        stubHandlers(),
      ),
    ).toThrow(TypeError);
  });
});
