/**
 * What the decision page knows about the answer it was given, with no DOM in it:
 * the current revision's text, the entries split between the current text and the
 * earlier ones, and for each earlier revision what changed and why. The page is
 * read-only — no answers are taken here — so the model is pure and total over a
 * response that has already passed `drawableDecision`.
 *
 * The current text's run — the unbroken tail of revisions sharing the current
 * revision's hash — is worked out the same rule the server uses, so the page can
 * split entries without a second response (see `src/domain/decision-state.ts`
 * `currentTextRun`).
 */

/**
 * The eight binding-text fields a revision may change, as the hash covers them:
 * the question, the options, the recommendation, the door, the commitments, who
 * may decide, what the instruction applies to, and whether it is answered
 * elsewhere. Each is named in the word the page uses, not the field name.
 */
const CHANGE_FIELDS = [
  ["question", "question"],
  ["options", "options"],
  ["recommended", "recommendation"],
  ["hardToUndo", "door"],
  ["commits", "commitments"],
  ["decider", "decider"],
  ["appliesTo", "applies-to"],
  ["actElsewhere", "act-elsewhere"],
];

/**
 * Whether two values are equal by their JSON text. A missing optional field and
 * one set to `undefined` both serialise to nothing, so a revision that gained or
 * lost a recommendation is said to have changed it.
 */
function isEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * The field labels that differ between two revisions, in the order above: the
 * page reads them in this fixed order so a history line that says "options and
 * recommendation changed" reads the same way every time.
 */
export function changesBetween(left, right) {
  const changed = [];
  for (const [field, label] of CHANGE_FIELDS) {
    if (!isEqual(left[field], right[field])) {
      changed.push(label);
    }
  }
  return changed;
}

/**
 * The unbroken tail of revisions sharing the current revision's text hash: the
 * revisions whose text is the one the page renders as "current", and to which an
 * entry belongs when its hash and index agree.
 */
function currentTextRun(revisions) {
  const hash = revisions[revisions.length - 1].textSha256;
  let first = revisions.length - 1;
  while (first > 0 && revisions[first - 1].textSha256 === hash) {
    first--;
  }
  return { firstRevision: revisions[first].revision, hash };
}

/** Whether an entry is on the current text, by the server's own rule. */
function isOnCurrentText(entry, run) {
  return entry.textSha256 === run.hash && entry.revision >= run.firstRevision;
}

/**
 * The decision page's model, built from the checked response: the current
 * revision's text and entries, the entries that belong to earlier texts, and for
 * each earlier revision what changed and its change note.
 */
export function decisionModel(view) {
  const revisions = view.revisions;
  const entries = view.entries;
  const currentRevision = revisions[revisions.length - 1];
  const run = currentTextRun(revisions);
  const currentEntries = entries.filter((entry) => isOnCurrentText(entry, run));
  const earlierEntries = entries.filter(
    (entry) => !isOnCurrentText(entry, run),
  );
  const revisionChanges = revisions.slice(0, -1).map((rev, i) => ({
    revision: rev.revision,
    receivedAt: rev.receivedAt,
    textSha256: rev.textSha256,
    decision: rev.decision,
    changed: changesBetween(rev.decision, revisions[i + 1].decision),
    changeNote: rev.decision.changeNote,
  }));
  return {
    head: view.head,
    currentRevision,
    currentEntries,
    earlierEntries,
    revisionChanges,
  };
}
