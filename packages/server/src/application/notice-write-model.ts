import {
  decisionBindingText,
  type DecisionRevision,
  type ValidationIssue,
  validateDecision,
  validateEvent,
  validateStateEntry,
  MAX_DECISIONS_PER_PROJECT,
  MAX_EVENTS_PER_PROJECT,
  MAX_REVISIONS_PER_DECISION,
  MAX_SESSION_ENTRIES_PER_DECISION,
} from "@hexagen-monaco/waves-contract";

import type {
  NoticeStorePort,
  StoredEntry,
} from "../application/ports/notice-store.js";
import type { Now } from "./read-model.js";

export interface NoticeWriteModelDeps {
  readonly noticeStore: NoticeStorePort;
  readonly now: Now;
  /** The lower-case hex sha256 of a string; injected, never imported here. */
  readonly hashText: (text: string) => string;
}

const STALE_ERROR = "the state entry is out of date";

function timestampOf(atMs: number): string {
  return new Date(atMs).toISOString();
}

/** Two validated decision revisions are the same iff every field is. */
function sameDecision(a: DecisionRevision, b: DecisionRevision): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export type RaiseDecision =
  | { readonly kind: "invalid"; readonly errors: readonly ValidationIssue[] }
  | { readonly kind: "ceiling" }
  | { readonly kind: "tooManyRevisions" }
  | { readonly kind: "conflict" }
  | {
      readonly kind: "stored";
      readonly revision: number;
      readonly textSha256: string;
      readonly created: boolean;
      readonly entries: number;
    };

export type PostState =
  | { readonly kind: "invalid"; readonly errors: readonly ValidationIssue[] }
  | { readonly kind: "notFound" }
  | {
      readonly kind: "conflict";
      readonly error: string;
      readonly revision: number;
      readonly textSha256: string;
      readonly entries: number;
    }
  | { readonly kind: "posted"; readonly index: number };

export type PostEvent =
  | { readonly kind: "invalid"; readonly errors: readonly ValidationIssue[] }
  | { readonly kind: "posted"; readonly id: string; readonly dropped: number };

export function createNoticeWriteModel(deps: NoticeWriteModelDeps) {
  const { noticeStore, now, hashText } = deps;

  /**
   * The body a writer sends must name the project and the decision the route
   * names: a body that slipped into another project's id is a 400, never a write.
   */
  function pathMismatch(
    body: DecisionRevision,
    project: string,
    id: string,
  ): readonly ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (body.project !== project) {
      issues.push({
        path: "/project",
        message: "expected the project the path names",
      });
    }
    if (body.id !== id) {
      issues.push({ path: "/id", message: "expected the id the path names" });
    }
    return issues;
  }

  return {
    async raiseDecision(
      project: string,
      id: string,
      body: unknown,
    ): Promise<RaiseDecision> {
      const validated = validateDecision(body);
      if (!validated.ok) {
        return { kind: "invalid", errors: validated.errors };
      }
      const pathIssues = pathMismatch(validated.value, project, id);
      if (pathIssues.length > 0) {
        return { kind: "invalid", errors: pathIssues };
      }
      const decision = validated.value;
      const textSha256 = hashText(decisionBindingText(decision));
      const stored = await noticeStore.getDecision(project, id);

      if (stored === undefined) {
        // A writer that found no decision sends expectRevisions 0 so the store
        // creates it; the store's ceiling refuses the create at the project cap.
        const outcome = await noticeStore.appendRevision(
          project,
          id,
          {
            revision: 1,
            textSha256,
            receivedAt: timestampOf(now()),
            decision,
          },
          0,
          MAX_DECISIONS_PER_PROJECT,
        );
        if (outcome === "ceiling") {
          return { kind: "ceiling" };
        }
        // A race created the decision between the read above and this append.
        if (outcome === "conflict") {
          return { kind: "conflict" };
        }
        return {
          kind: "stored",
          revision: 1,
          textSha256,
          created: true,
          entries: 0,
        };
      }

      const revisions = stored.revisions;
      const current = revisions[revisions.length - 1]!;
      const currentRevision = current.revision;
      const currentEntries = stored.entries.length;
      if (sameDecision(decision, current.decision)) {
        return {
          kind: "stored",
          revision: currentRevision,
          textSha256: current.textSha256,
          created: false,
          entries: currentEntries,
        };
      }
      if (currentRevision >= MAX_REVISIONS_PER_DECISION) {
        return { kind: "tooManyRevisions" };
      }
      const outcome = await noticeStore.appendRevision(
        project,
        id,
        {
          revision: currentRevision + 1,
          textSha256,
          receivedAt: timestampOf(now()),
          decision,
        },
        currentRevision,
        MAX_DECISIONS_PER_PROJECT,
      );
      if (outcome === "stored") {
        return {
          kind: "stored",
          revision: currentRevision + 1,
          textSha256,
          created: true,
          entries: currentEntries,
        };
      }
      // A conflict here means the count moved between the read above and this
      // append — the writer must re-read before it writes again.
      return { kind: "conflict" };
    },

    async postState(
      project: string,
      id: string,
      body: unknown,
    ): Promise<PostState> {
      const validated = validateStateEntry(body);
      if (!validated.ok) {
        return { kind: "invalid", errors: validated.errors };
      }
      const entry = validated.value;
      const stored = await noticeStore.getDecision(project, id);
      if (stored === undefined) {
        return { kind: "notFound" };
      }
      const revisions = stored.revisions;
      const current = revisions[revisions.length - 1]!;
      const currentRevision = current.revision;
      const currentHash = current.textSha256;
      const currentEntries = stored.entries.length;

      // Rule 2: the entry pins the exact revision, hash and count it read.
      if (
        entry.revision !== currentRevision ||
        entry.textSha256 !== currentHash ||
        entry.expectedEntries !== currentEntries
      ) {
        return {
          kind: "conflict",
          error: STALE_ERROR,
          revision: currentRevision,
          textSha256: currentHash,
          entries: currentEntries,
        };
      }

      const issues: ValidationIssue[] = [];
      if (entry.option !== undefined) {
        const keys = new Set(current.decision.options.map((o) => o.key));
        if (!keys.has(entry.option)) {
          issues.push({
            path: "/option",
            message: "expected an option key of the current revision",
          });
        }
      }
      if (entry.supersededBy !== undefined) {
        const other = await noticeStore.getDecision(
          project,
          entry.supersededBy,
        );
        if (other === undefined || other.id === id) {
          issues.push({
            path: "/supersededBy",
            message: "expected another existing decision of this project",
          });
        }
      }
      if (issues.length > 0) {
        return { kind: "invalid", errors: issues };
      }

      if (currentEntries >= MAX_SESSION_ENTRIES_PER_DECISION) {
        return {
          kind: "conflict",
          error: `at most ${MAX_SESSION_ENTRIES_PER_DECISION} session entries per decision`,
          revision: currentRevision,
          textSha256: currentHash,
          entries: currentEntries,
        };
      }

      const { expectedEntries, ...rest } = entry;
      const storedEntry: StoredEntry = {
        ...rest,
        index: currentEntries,
        receivedAt: timestampOf(now()),
      };
      const outcome = await noticeStore.appendEntry(
        project,
        id,
        storedEntry,
        expectedEntries,
      );
      if (outcome === "missing") {
        return { kind: "notFound" };
      }
      if (outcome === "conflict") {
        // The count moved between the read and the store's own compare.
        return {
          kind: "conflict",
          error: STALE_ERROR,
          revision: currentRevision,
          textSha256: currentHash,
          entries: currentEntries,
        };
      }
      return { kind: "posted", index: currentEntries };
    },

    async postEvent(project: string, body: unknown): Promise<PostEvent> {
      const validated = validateEvent(body);
      if (!validated.ok) {
        return { kind: "invalid", errors: validated.errors };
      }
      if (validated.value.project !== project) {
        return {
          kind: "invalid",
          errors: [
            {
              path: "/project",
              message: "expected the project the path names",
            },
          ],
        };
      }
      const event = validated.value;
      const receivedAt = timestampOf(now());
      const events = await noticeStore.listEvents(
        project,
        MAX_EVENTS_PER_PROJECT,
      );
      const id = `${receivedAt}-${events.length + 1}`;
      const result = await noticeStore.appendEvent(
        project,
        { id, receivedAt, event },
        MAX_EVENTS_PER_PROJECT,
      );
      return { kind: "posted", id, dropped: result.dropped };
    },
  };
}

export type NoticeWriteModel = ReturnType<typeof createNoticeWriteModel>;
