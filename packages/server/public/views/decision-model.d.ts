import type {
  DecisionView,
  Head,
} from "../../src/application/notice-read-model.js";
import type {
  StoredEntry,
  StoredRevision,
} from "../../src/application/ports/notice-store.js";
import type { DecisionRevision } from "@hexagen-monaco/waves-contract";

/** One earlier revision in the model: what changed, and the change note. */
export interface RevisionChange {
  readonly revision: number;
  readonly receivedAt: string;
  readonly textSha256: string;
  readonly decision: DecisionRevision;
  /** The binding-text fields that differ from the next revision, by the page's words. */
  readonly changed: readonly string[];
  /** The human-readable note the session wrote, when it did. */
  readonly changeNote?: string;
}

/**
 * The decision page's model: the current revision and its entries, the entries
 * on earlier texts, and for each earlier revision what changed relative to the
 * revision that followed it.
 */
export interface DecisionModel {
  readonly head: Head;
  readonly currentRevision: StoredRevision;
  readonly currentEntries: readonly StoredEntry[];
  readonly earlierEntries: readonly StoredEntry[];
  readonly revisionChanges: readonly RevisionChange[];
}

/**
 * The binding-text field labels that differ between two revisions, in the order
 * the page reads them: "question", "options", "recommendation", "door",
 * "commitments", "decider", "applies-to", "act-elsewhere".
 */
export declare function changesBetween(
  left: DecisionRevision,
  right: DecisionRevision,
): string[];

/**
 * Builds the model from a response that has passed `drawableDecision`: the
 * current revision (the last one), its entries, the earlier entries, and for
 * each earlier revision what changed and its change note.
 */
export declare function decisionModel(view: DecisionView): DecisionModel;
