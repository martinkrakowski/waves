/**
 * The shape check for `GET /api/v1/projects/<project>/decisions/<id>`: the whole
 * record of one decision — its head, its revisions and its state entries. It is
 * checked here rather than in the view because the ids it carries are what the
 * page builds links out of: a head that calls itself another project's decision
 * is a response the page has no path for, and a page that guessed one is a dead
 * end a reader can see and not follow.
 *
 * The enums and the head's own rules are taken from `inbox.js` and not copied:
 * the inbox pins them once and the decision page pins nothing of its own. The
 * one addition is `history` as a group: the server leaves a decision older than
 * fourteen days out of the inbox entirely, so a head that calls itself one is a
 * response the inbox has no heading for — but this page is the history it went
 * to, so a `history` group is a response it must be able to draw.
 */

import {
  actElsewhere,
  answer,
  count,
  door,
  GROUPS,
  GROUP_STATES,
  oneOf,
  SHAPES,
  SOURCES,
  STATES,
  time,
} from "./inbox.js";
import { isProjectId, isWaveId } from "./patterns.js";

/** "waves-notice/v1", the only schema a decision revision carries. */
const NOTICE_SCHEMA = "waves-notice/v1";

/** The four groups the decision page reads, history included. */
const DECISION_GROUPS = [...GROUPS, "history"];

/** "owner" and "delegated": who may decide, as the contract allows. */
const DECIDERS = ["owner", "delegated"];

/** An option key: 1 to 8 lower-case ASCII letters and digits. */
const OPTION_KEY = /^[a-z0-9]{1,8}$/;

/** A whole number of at least one: a revision number, a PR number. */
function positiveInt(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

/** An option key as the contract reads it. */
function optionKey(value) {
  return typeof value === "string" && OPTION_KEY.test(value);
}

/** One option: a key, a text and a cost, all of them strings. */
function optionEntry(option) {
  return (
    option !== null &&
    typeof option === "object" &&
    optionKey(option.key) &&
    typeof option.text === "string" &&
    typeof option.cost === "string"
  );
}

/** One evidence link: a label and an `https://` href, nothing else. */
function evidenceEntry(link) {
  return (
    link !== null &&
    typeof link === "object" &&
    typeof link.label === "string" &&
    typeof link.href === "string" &&
    link.href.startsWith("https://")
  );
}

/**
 * The optional `refs` object: a wave id, a lane id and a PR number. Lane ids
 * share the wave id pattern in `patterns.js`, so `isWaveId` checks both.
 */
function refsEntry(refs) {
  if (refs === undefined) {
    return true;
  }
  return (
    refs !== null &&
    typeof refs === "object" &&
    (refs.wave === undefined || isWaveId(refs.wave)) &&
    (refs.lane === undefined || isWaveId(refs.lane)) &&
    (refs.pr === undefined || positiveInt(refs.pr))
  );
}

/**
 * One decision revision as the store holds it. The `project` and `id` it names
 * are the ones the page asked for: a revision that calls itself another
 * decision's is a response the page can neither draw nor name a path to. The
 * `optionKeys` are its own, so a `recommended` that names one it does not carry
 * is refused rather than drawn as a mark with no option to point at.
 */
function decisionRevision(decision, project, id) {
  if (
    decision === null ||
    typeof decision !== "object" ||
    decision.schema !== NOTICE_SCHEMA ||
    decision.kind !== "decision" ||
    decision.project !== project ||
    decision.id !== id
  ) {
    return false;
  }
  const opts = Array.isArray(decision.options) ? decision.options : [];
  const keys = opts.map((o) => o.key);
  return (
    oneOf(decision.shape, SHAPES) &&
    typeof decision.question === "string" &&
    opts.every(optionEntry) &&
    (decision.recommended === undefined ||
      (decision.recommended !== null &&
        typeof decision.recommended === "object" &&
        optionKey(decision.recommended.option) &&
        keys.includes(decision.recommended.option) &&
        typeof decision.recommended.reason === "string")) &&
    door(decision.hardToUndo) &&
    Array.isArray(decision.commits) &&
    decision.commits.every((c) => typeof c === "string") &&
    oneOf(decision.decider, DECIDERS) &&
    Array.isArray(decision.appliesTo) &&
    decision.appliesTo.every(isProjectId) &&
    Array.isArray(decision.evidence) &&
    decision.evidence.every(evidenceEntry) &&
    actElsewhere(decision.actElsewhere) &&
    typeof decision.raisedBy === "string" &&
    time(decision.raisedAt) &&
    refsEntry(decision.refs) &&
    (decision.changeNote === undefined ||
      typeof decision.changeNote === "string")
  );
}

/**
 * One revision as the store holds it: the number, the hash, the receive time
 * and the decision revision itself.
 */
function storedRevision(rev, project, id) {
  return (
    rev !== null &&
    typeof rev === "object" &&
    positiveInt(rev.revision) &&
    typeof rev.textSha256 === "string" &&
    time(rev.receivedAt) &&
    decisionRevision(rev.decision, project, id)
  );
}

/**
 * One state entry as the store holds it. The `revision` it names is checked
 * against the revision numbers the head carries, so an entry for a revision
 * that is not among them is refused rather than drawn as history it is not.
 */
function storedEntry(entry, revisionNumbers) {
  return (
    entry !== null &&
    typeof entry === "object" &&
    count(entry.index) &&
    time(entry.receivedAt) &&
    oneOf(entry.state, STATES) &&
    oneOf(entry.source, SOURCES) &&
    count(entry.revision) &&
    revisionNumbers.has(entry.revision) &&
    typeof entry.textSha256 === "string" &&
    typeof entry.by === "string" &&
    time(entry.at) &&
    (entry.words === undefined || typeof entry.words === "string") &&
    (entry.option === undefined || typeof entry.option === "string") &&
    (entry.reason === undefined || typeof entry.reason === "string") &&
    (entry.supersededBy === undefined || isWaveId(entry.supersededBy))
  );
}

/**
 * The head as the decision page reads it: the inbox's own checks, with three
 * differences. The `project` and `id` must equal the ones asked for, not merely
 * be valid ids. The `group` may be `history`, which the inbox never shows. And
 * a `history` group holds any written state — it is the state the decision left,
 * not one the page has a sentence for.
 */
function decisionHead(head, project, id) {
  return (
    head !== null &&
    typeof head === "object" &&
    isProjectId(head.project) &&
    head.project === project &&
    isWaveId(head.id) &&
    head.id === id &&
    typeof head.question === "string" &&
    oneOf(head.shape, SHAPES) &&
    door(head.door) &&
    oneOf(head.decider, DECIDERS) &&
    count(head.revision) &&
    count(head.revisions) &&
    head.revision >= 1 &&
    head.revision <= head.revisions &&
    typeof head.textSha256 === "string" &&
    count(head.entries) &&
    oneOf(head.state, STATES) &&
    (head.source === undefined || oneOf(head.source, SOURCES)) &&
    time(head.at) &&
    oneOf(head.group, DECISION_GROUPS) &&
    (head.group !== "reported" || head.source === "reported") &&
    (head.group === "history" ||
      GROUP_STATES[head.group].includes(head.state)) &&
    actElsewhere(head.actElsewhere) &&
    (head.earlierAnswer === undefined || answer(head.earlierAnswer)) &&
    (head.coveredAnswer === undefined || answer(head.coveredAnswer)) &&
    (head.from === undefined || isProjectId(head.from))
  );
}

/**
 * Whether a response is a decision page this app can draw at all. The shape says
 * "no": a response that carries a head the page cannot pin to a path, revisions
 * that do not number 1 to n in order, or entries that name a revision the page
 * does not hold is a broken endpoint — the app treats it as a failed load rather
 * than replacing a page that was right with one it could only half fill.
 */
export function drawableDecision(view, project, id) {
  if (
    view === null ||
    typeof view !== "object" ||
    !decisionHead(view.head, project, id)
  ) {
    return false;
  }
  const revisions = view.revisions;
  if (!Array.isArray(revisions) || revisions.length === 0) {
    return false;
  }
  const nums = new Set();
  for (let i = 0; i < revisions.length; i++) {
    const rev = revisions[i];
    if (!storedRevision(rev, project, id) || rev.revision !== i + 1) {
      return false;
    }
    nums.add(rev.revision);
  }
  const entries = view.entries;
  if (!Array.isArray(entries)) {
    return false;
  }
  if (!entries.every((entry) => storedEntry(entry, nums))) {
    return false;
  }
  const last = revisions[revisions.length - 1];
  return (
    view.head.revision === last.revision &&
    view.head.revisions === revisions.length &&
    view.head.textSha256 === last.textSha256 &&
    view.head.entries === entries.length
  );
}
