import type {
  Decider,
  DecisionRevision,
  DecisionShape,
  DecisionState,
  DoorValue,
  Project,
  StateSource,
  StoredSnapshot,
} from "@hexagen-monaco/waves-contract";

import {
  coveredAnswer,
  currentEntry,
  decisionState,
  earlierAnswer,
  groupOf,
  type DecisionGroup,
} from "../domain/decision-state.js";
import type {
  NoticeStorePort,
  StoredDecision,
  StoredEntry,
  StoredEvent,
  StoredRevision,
} from "./ports/notice-store.js";
import type { StorePort } from "./ports/store.js";
import type { Now } from "./read-model.js";

export interface NoticeCounts {
  readonly waiting: number;
  readonly oneWay: number;
  readonly reported: number;
  readonly closed: number;
}

/** A current or earlier answer, as a head carries it. */
export interface NoticeAnswer {
  readonly state: DecisionState;
  readonly source: StateSource;
  readonly at: string;
  readonly by: string;
  readonly words?: string;
  readonly option?: string;
}

export interface Head {
  readonly project: string;
  readonly id: string;
  readonly question: string;
  readonly shape: DecisionShape;
  readonly door: { readonly value: DoorValue; readonly reason?: string };
  readonly decider: Decider;
  readonly revision: number;
  readonly revisions: number;
  readonly textSha256: string;
  readonly entries: number;
  readonly state: DecisionState;
  readonly source?: StateSource;
  readonly at: string;
  readonly group: DecisionGroup;
  readonly actElsewhere?: { readonly where: string; readonly what: string };
  readonly earlierAnswer?: NoticeAnswer;
  readonly coveredAnswer?: NoticeAnswer;
  readonly from?: string;
}

export interface DecisionView {
  readonly head: Head;
  readonly revisions: readonly StoredRevision[];
  readonly entries: readonly StoredEntry[];
}

export interface EventView {
  readonly events: readonly StoredEvent[];
}

export interface InboxProject {
  readonly id: string;
  readonly name: string;
  readonly counts: NoticeCounts;
  readonly decisions: readonly Head[];
}

const GROUP_ORDER: Readonly<Record<DecisionGroup, number>> = {
  waiting: 0,
  reported: 1,
  closed: 2,
  history: 3,
};

/** A decision always has a current revision: it is created with revision 1. */
function currentRevision(decision: StoredDecision): StoredRevision {
  return decision.revisions[decision.revisions.length - 1] as StoredRevision;
}

function doorOf(decision: DecisionRevision): {
  value: DoorValue;
  reason?: string;
} {
  const hardToUndo = decision.hardToUndo;
  return hardToUndo.reason === undefined
    ? { value: hardToUndo.value }
    : { value: hardToUndo.value, reason: hardToUndo.reason };
}

function toAnswer(entry: StoredEntry): NoticeAnswer {
  return {
    state: entry.state,
    source: entry.source,
    at: entry.receivedAt,
    by: entry.by,
    ...(entry.words === undefined ? {} : { words: entry.words }),
    ...(entry.option === undefined ? {} : { option: entry.option }),
  };
}

/**
 * Counts only a project's own decisions, never the instructions another project
 * raises against it: a card drawn with another project's name does not move this
 * project's glance count (rule 1). `oneWay` is the waiting cards whose door is
 * true, and the four are never summed into one number.
 */
export function noticeCounts(
  decisions: readonly StoredDecision[],
  nowMs: number,
): NoticeCounts {
  let waiting = 0;
  let oneWay = 0;
  let reported = 0;
  let closed = 0;
  for (const decision of decisions) {
    const group = groupOf(decision, nowMs);
    if (group === "waiting") {
      waiting += 1;
      if (doorOf(currentRevision(decision).decision).value === true) {
        oneWay += 1;
      }
    } else if (group === "reported") {
      reported += 1;
    } else if (group === "closed") {
      closed += 1;
    }
  }
  return { waiting, oneWay, reported, closed };
}

function headOf(decision: StoredDecision, nowMs: number, from?: string): Head {
  const revision = currentRevision(decision);
  const decisionRevision = revision.decision;
  const entry = currentEntry(decision);
  const earlier = earlierAnswer(decision);
  const covered = coveredAnswer(decision);
  return {
    project: decision.project,
    id: decision.id,
    question: decisionRevision.question,
    shape: decisionRevision.shape,
    door: doorOf(decisionRevision),
    decider: decisionRevision.decider,
    revision: revision.revision,
    revisions: decision.revisions.length,
    textSha256: revision.textSha256,
    entries: decision.entries.length,
    state: decisionState(decision),
    ...(entry === undefined ? {} : { source: entry.source }),
    at: entry === undefined ? revision.receivedAt : entry.receivedAt,
    group: groupOf(decision, nowMs),
    ...(decisionRevision.actElsewhere === undefined
      ? {}
      : { actElsewhere: decisionRevision.actElsewhere }),
    ...(earlier === undefined ? {} : { earlierAnswer: toAnswer(earlier) }),
    ...(covered === undefined ? {} : { coveredAnswer: toAnswer(covered) }),
    ...(from === undefined ? {} : { from }),
  };
}

function compareHeads(a: Head, b: Head): number {
  const gA = GROUP_ORDER[a.group];
  const gB = GROUP_ORDER[b.group];
  if (gA !== gB) {
    return gA - gB;
  }
  const dA = a.door.value === true ? 0 : 1;
  const dB = b.door.value === true ? 0 : 1;
  if (dA !== dB) {
    return dA - dB;
  }
  const atA = Date.parse(a.at);
  const atB = Date.parse(b.at);
  return atA === atB ? 0 : atA < atB ? -1 : 1;
}

export interface NoticeReadModel {
  counts(project: string): Promise<NoticeCounts>;
  decisions(project: string): Promise<readonly Head[]>;
  getDecision(project: string, id: string): Promise<DecisionView | undefined>;
  events(project: string, limit: number): Promise<readonly StoredEvent[]>;
  inbox(): Promise<readonly InboxProject[]>;
}

export interface NoticeReadModelDeps {
  readonly store: StorePort<Project, StoredSnapshot>;
  readonly noticeStore: NoticeStorePort;
  readonly now: Now;
}

/** The most events a project's listing answers with. */
export const MAX_NOTICE_EVENTS = 200;

export function createNoticeReadModel(
  deps: NoticeReadModelDeps,
): NoticeReadModel {
  const { store, noticeStore, now } = deps;

  /**
   * A project's own decisions, plus every instruction another project raised
   * against it (the `appliesTo` of an `instruction` decision that names this
   * project). `from` carries the raising project; the head otherwise describes
   * the decision that raised it.
   */
  async function decisionsOf(project: string): Promise<Head[]> {
    const own = await noticeStore.listDecisions(project);
    const nowMs = now();
    const heads: Head[] = own.map((decision) => headOf(decision, nowMs));

    const projects = await store.listProjects();
    for (const other of projects) {
      if (other.id === project) {
        continue;
      }
      const theirs = await noticeStore.listDecisions(other.id);
      for (const decision of theirs) {
        const dec = currentRevision(decision).decision;
        if (dec.shape === "instruction" && dec.appliesTo.includes(project)) {
          heads.push(headOf(decision, nowMs, other.id));
        }
      }
    }
    heads.sort(compareHeads);
    return heads;
  }

  async function inbox(): Promise<InboxProject[]> {
    const nowMs = now();
    const projects = await store.listProjects();
    const result: InboxProject[] = [];
    for (const project of projects) {
      const own = await noticeStore.listDecisions(project.id);
      const counts = noticeCounts(own, nowMs);
      const decisions = (await decisionsOf(project.id)).filter(
        (head) => head.group !== "history",
      );
      result.push({
        id: project.id,
        name: project.name,
        counts,
        decisions,
      });
    }
    return result;
  }

  return {
    async counts(project) {
      const own = await noticeStore.listDecisions(project);
      return noticeCounts(own, now());
    },
    decisions: (project) => decisionsOf(project),
    async getDecision(project, id) {
      const decision = await noticeStore.getDecision(project, id);
      if (decision === undefined) {
        return undefined;
      }
      return {
        head: headOf(decision, now()),
        revisions: decision.revisions,
        entries: decision.entries,
      };
    },
    async events(project, limit) {
      return noticeStore.listEvents(project, limit);
    },
    inbox,
  };
}
