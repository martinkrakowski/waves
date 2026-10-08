import { NOTICE_SCHEMA } from "../../src/domain/model.js";

export interface NoticeFixture {
  id: string;
  project: string;
  revision: Record<string, unknown>;
  states: Array<Record<string, unknown>>;
}

const HASH = "0".repeat(64);

function decision(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    schema: NOTICE_SCHEMA,
    kind: "decision",
    shape: "choice",
    question: "Q?",
    options: [
      { key: "a", text: "A", cost: "C1" },
      { key: "b", text: "B", cost: "C2" },
    ],
    hardToUndo: { value: false },
    commits: [],
    decider: "owner",
    appliesTo: [],
    evidence: [],
    raisedBy: "session",
    raisedAt: "2026-10-08T12:00:00Z",
    ...overrides,
  };
}

function state(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    state: "approved",
    source: "reported",
    revision: 1,
    textSha256: HASH,
    expectedEntries: 0,
    by: "owner",
    at: "2026-10-08T13:00:00Z",
    words: "Go with A",
    ...overrides,
  };
}

export const NOTICE_DECISIONS: NoticeFixture[] = [
  {
    id: "d12-document-owner",
    project: "hexagen-monaco",
    revision: decision({
      id: "d12-document-owner",
      project: "hexagen-monaco",
      question: "Should the D-12 owner field be printed?",
      options: [
        {
          key: "a",
          text: "Never print it",
          cost: "Cannot tell which to retry",
        },
        { key: "b", text: "On failure only", cost: "Appears in one terminal" },
        { key: "c", text: "Store it", cost: "A new record of an erased user" },
      ],
      recommended: { option: "c", reason: "The owner needs the trail" },
      hardToUndo: { value: true, reason: "key in every row and route" },
      commits: ["Commit one", "Commit two", "Commit three"],
    }),
    states: [
      state({
        state: "approved",
        option: "c",
        words: "Go with option 3 for D-12",
        by: "hexagen-monaco session",
      }),
    ],
  },
  {
    id: "prod-postgres-home",
    project: "hexagen-monaco",
    revision: decision({
      id: "prod-postgres-home",
      project: "hexagen-monaco",
      question: "Keep the prod postgres home directory?",
      hardToUndo: { value: true, reason: "the data is not backed up" },
      actElsewhere: { where: "session pg-1", what: "set it up yourself" },
    }),
    states: [],
  },
  {
    id: "erase-user-prints-id",
    project: "campaign-foundry",
    revision: decision({
      id: "erase-user-prints-id",
      project: "campaign-foundry",
      question: "Print the erased user's id on incomplete erasure?",
      options: [
        {
          key: "a",
          text: "Never print it",
          cost: "Cannot tell which to retry",
        },
        { key: "b", text: "On failure only", cost: "Appears in one terminal" },
        { key: "c", text: "Store it", cost: "A new record of an erased user" },
      ],
      recommended: { option: "b", reason: "Needs it once, stored nowhere" },
      hardToUndo: { value: false, reason: "A message text" },
      decider: "delegated",
      evidence: [{ label: "PR 731", href: "https://github.com/x/pull/731" }],
      raisedBy: "campaign-foundry session",
      refs: { wave: "platform-and-tenancy-w07", lane: "PT-9x", pr: 731 },
    }),
    states: [
      state({
        state: "delegated",
        source: "session",
        option: "b",
        by: "fleet session",
        words: undefined,
      }),
    ],
  },
  {
    id: "first-purge-org-apply",
    project: "campaign-foundry",
    revision: decision({
      id: "first-purge-org-apply",
      project: "campaign-foundry",
      shape: "action",
      question: "Apply the first org purge now?",
      options: [],
      hardToUndo: { value: true, reason: "deletes an org's data" },
      actElsewhere: {
        where: "session cf-74",
        what: "run yarn purge:org --apply",
      },
    }),
    states: [],
  },
  {
    id: "required-check-on-main",
    project: "campaign-foundry",
    revision: decision({
      id: "required-check-on-main",
      project: "campaign-foundry",
      question: "Require a check on main?",
      hardToUndo: { value: false },
      actElsewhere: {
        where: "session cf-74",
        what: "allow the ruleset edit there",
      },
    }),
    states: [],
  },
  {
    id: "give-up-bound",
    project: "gate-lock",
    revision: decision({
      id: "give-up-bound",
      project: "gate-lock",
      question: "Should we give up the bound?",
      options: [
        { key: "a", text: "Give it up", cost: "The lock is obsolete" },
        { key: "b", text: "Keep it", cost: "Safety remains" },
        { key: "c", text: "Adjust it", cost: "A tighter fit" },
      ],
      recommended: { option: "a", reason: "The lock has served its purpose" },
      hardToUndo: { value: false, reason: "A message" },
      decider: "delegated",
      raisedBy: "gate-lock session",
      changeNote: "narrowed after the session reported a window",
    }),
    states: [
      state({
        state: "delegated",
        source: "session",
        option: "a",
        by: "fleet session",
        words: undefined,
      }),
    ],
  },
  {
    id: "heartbeat-lock",
    project: "gate-lock",
    revision: decision({
      id: "heartbeat-lock",
      project: "gate-lock",
      question: "Should the heartbeat lock check remain?",
      options: [
        { key: "a", text: "Yes, keep it", cost: "Detects dead peers" },
        { key: "b", text: "No, remove it", cost: "Less noise" },
      ],
      hardToUndo: { value: "partly", reason: "a design change" },
      evidence: [{ label: "Issue 15", href: "https://github.com/x/issues/15" }],
    }),
    states: [],
  },
  {
    id: "test-db-switch-hold",
    project: "fleet",
    revision: decision({
      id: "test-db-switch-hold",
      project: "fleet",
      question: "Hold or lift the test db switch?",
      options: [
        { key: "hold", text: "Keep the old test db", cost: "No risk" },
        {
          key: "lift",
          text: "Switch to the new test db",
          cost: "Better tests",
        },
      ],
      recommended: { option: "lift", reason: "The new db is ready" },
      hardToUndo: { value: false },
      decider: "owner",
    }),
    states: [
      state({ state: "answered", option: "hold", words: "Hold the switch" }),
      state({
        state: "approved",
        option: "lift",
        words: "Lift the switch",
        expectedEntries: 1,
      }),
    ],
  },
  {
    id: "offsite-backup-cost",
    project: "fleet",
    revision: decision({
      id: "offsite-backup-cost",
      project: "fleet",
      question: "Keep the offsite backup given its cost?",
      hardToUndo: { value: false },
    }),
    states: [],
  },
  {
    id: "rls-before-first-client",
    project: "client-portal",
    revision: decision({
      id: "rls-before-first-client",
      project: "client-portal",
      question: "Enable RLS before the first client?",
      evidence: [{ label: "Issue 71", href: "https://github.com/x/issues/71" }],
    }),
    states: [],
  },
  {
    id: "delete-three-branches",
    project: "client-portal",
    revision: decision({
      id: "delete-three-branches",
      project: "client-portal",
      question: "Delete the three stale branches?",
      hardToUndo: {
        value: "partly",
        reason: "the deletion cannot be undone; merged or obsolete",
      },
    }),
    states: [],
  },
  {
    id: "install-sync-agent",
    project: "waves",
    revision: decision({
      id: "install-sync-agent",
      project: "waves",
      question: "Install the sync agent on this machine?",
      options: [
        { key: "a", text: "Yes, install it", cost: "a change to your machine" },
        { key: "b", text: "No, skip it", cost: "No changes" },
      ],
      hardToUndo: { value: false },
    }),
    states: [],
  },
  {
    id: "backup-job-in-freeze",
    project: "fleet",
    revision: decision({
      id: "backup-job-in-freeze",
      project: "fleet",
      question: "Run the backup job during the standing freeze?",
      recommended: { option: "b", reason: "the standing freeze covers it" },
      hardToUndo: { value: true, reason: "a production deployment" },
    }),
    states: [],
  },
  {
    id: "clean-merged-worktrees",
    project: "fleet",
    revision: decision({
      id: "clean-merged-worktrees",
      project: "fleet",
      shape: "instruction",
      question: "Clean the merged worktrees",
      options: [],
      hardToUndo: { value: "partly", reason: "deleting; branches kept" },
      appliesTo: ["alpha", "beta", "gamma", "delta", "epsilon"],
    }),
    states: [
      state({
        state: "approved",
        option: undefined,
        words: "Clean the merged worktrees",
      }),
    ],
  },
];
