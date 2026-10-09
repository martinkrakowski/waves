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

/**
 * The answer `GET /api/v1/inbox` gives: one entry per registered project, each
 * with its own counts and the decisions still in the reader's inbox. The counts
 * cover a project's own decisions only — instructions another project raised
 * against it are drawn beside the project that raised them and never counted in
 * its totals.
 */
export interface InboxView {
  readonly projects: readonly InboxProject[];
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
  /** The counts and heads for one project, from a single listing of every project's decisions. */
  decisionsView(project: string): Promise<{
    readonly counts: NoticeCounts;
    readonly decisions: readonly Head[];
  }>;
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
   * One pass over the store: every project's decisions, keyed by id. Both the
   * inbox and a project's own page need every project's decisions — the page to
   * find the `appliesTo` instructions another project raised against it — so this
   * loads them once and lets the callers below reuse the result instead of
   * relisting per project (rule: no P × P listings in one request).
   */
  async function loadAllDecisions(): Promise<{
    projects: readonly Project[];
    decisions: Map<string, readonly StoredDecision[]>;
    nowMs: number;
  }> {
    const projects = await store.listProjects();
    const nowMs = now();
    const decisions = new Map<string, readonly StoredDecision[]>();
    for (const project of projects) {
      decisions.set(project.id, await noticeStore.listDecisions(project.id));
    }
    return { projects, decisions, nowMs };
  }

  /**
   * A project's heads: its own decisions, plus every `instruction` of another
   * project whose `appliesTo` names this one, marked `from` the raiser. Both sets
   * come from the map loaded once by `loadAllDecisions`, so a request lists each
   * project's decisions at most once.
   */
  function headsOf(
    project: string,
    projects: readonly Project[],
    decisions: Map<string, readonly StoredDecision[]>,
    nowMs: number,
  ): Head[] {
    const heads = (decisions.get(project) ?? []).map((decision) =>
      headOf(decision, nowMs),
    );
    for (const other of projects) {
      if (other.id === project) {
        continue;
      }
      const theirs = decisions.get(other.id)!;
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
    const { projects, decisions, nowMs } = await loadAllDecisions();
    const result: InboxProject[] = [];
    for (const project of projects) {
      const own = decisions.get(project.id)!;
      result.push({
        id: project.id,
        name: project.name,
        counts: noticeCounts(own, nowMs),
        decisions: headsOf(project.id, projects, decisions, nowMs).filter(
          (head) => head.group !== "history" && head.from === undefined,
        ),
      });
    }
    return result;
  }

  /**
   * The heads and the counts for one project, built from the single listing of
   * every project's decisions: `counts`, `decisions` and the `/decisions` route
   * all reuse it, so a request lists each project's decisions at most once.
   */
  async function viewProject(project: string): Promise<{
    counts: NoticeCounts;
    decisions: readonly Head[];
  }> {
    const { projects, decisions: map, nowMs } = await loadAllDecisions();
    return {
      counts: noticeCounts(map.get(project) ?? [], nowMs),
      decisions: headsOf(project, projects, map, nowMs),
    };
  }

  return {
    async counts(project) {
      return (await viewProject(project)).counts;
    },
    decisions: async (project) => {
      return (await viewProject(project)).decisions;
    },
    decisionsView: viewProject,
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
