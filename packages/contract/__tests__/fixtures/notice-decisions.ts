/**
 * The fourteen test decisions of docs/planning/2026-10-08_decisions-inbox.md
 * section 7, worded from the fleet's requirements table. Where that table
 * records no cost, reason or words, the text says so (`UNRECORDED`) rather than
 * inventing one: these are shown on a page the owner reads.
 */
import { NOTICE_SCHEMA } from "../../src/domain/model.js";

export interface NoticeFixture {
  id: string;
  project: string;
  revisions: Array<Record<string, unknown>>;
  states: Array<Record<string, unknown>>;
}

const HASH = "0".repeat(64);

function decision(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    schema: NOTICE_SCHEMA,
    kind: "decision",
    shape: "choice",
    question: "Question?",
    options: [
      { key: "a", text: "Yes", cost: "C1" },
      { key: "b", text: "No", cost: "C2" },
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

const UNRECORDED = "Not recorded in the fleet's summary";

const YES_NO = [
  { key: "yes", text: "Yes", cost: UNRECORDED },
  { key: "no", text: "No", cost: UNRECORDED },
];

function one(
  project: string,
  id: string,
  overrides: Record<string, unknown>,
  states: Record<string, unknown>[] = [],
): NoticeFixture {
  return {
    id,
    project,
    revisions: [decision({ project, id, ...overrides })],
    states,
  };
}

const GIVE_UP = {
  project: "gate-lock",
  id: "give-up-bound",
  decider: "delegated",
  recommended: { option: "a", reason: UNRECORDED },
};

export const NOTICE_DECISIONS: NoticeFixture[] = [
  one(
    "hexagen-monaco",
    "d12-document-owner",
    {
      question:
        "Who owns a document: a user, a tenant, or a tenant and an author?",
      options: [
        { key: "a", text: "A user", cost: UNRECORDED },
        { key: "b", text: "A tenant", cost: UNRECORDED },
        { key: "c", text: "A tenant and an author", cost: UNRECORDED },
      ],
      recommended: { option: "c", reason: UNRECORDED },
      hardToUndo: { value: true, reason: "the key is in every row and route" },
      commits: [
        "A removed member's unpushed edits are destroyed",
        "A second commitment, to be supplied by the hexagen-monaco session",
        "A third commitment, to be supplied by the hexagen-monaco session",
      ],
    },
    [
      state({
        option: "c",
        by: "hexagen-monaco session",
        words: "Go with option 3 for D-12",
      }),
    ],
  ),
  one("hexagen-monaco", "prod-postgres-home", {
    question: "Where does production Postgres run?",
    options: [
      { key: "a", text: "Managed", cost: UNRECORDED },
      { key: "b", text: "Self-hosted", cost: UNRECORDED },
    ],
    hardToUndo: { value: true, reason: "where production data lives" },
    actElsewhere: { where: "your own setup", what: "you set it up yourself" },
  }),
  one(
    "campaign-foundry",
    "erase-user-prints-id",
    {
      question:
        "May erase:user print the erased user's id when an erasure ends incomplete?",
      options: [
        { key: "a", text: "Never", cost: UNRECORDED },
        { key: "b", text: "On failure only", cost: UNRECORDED },
        { key: "c", text: "Store it", cost: UNRECORDED },
      ],
      recommended: { option: "b", reason: UNRECORDED },
      hardToUndo: { value: false, reason: "a message text" },
      decider: "delegated",
    },
    [
      state({
        state: "delegated",
        source: "session",
        option: "b",
        by: "fleet session",
        words: undefined,
      }),
    ],
  ),
  one("campaign-foundry", "first-purge-org-apply", {
    shape: "action",
    question: "Run the first yarn purge:org --apply",
    options: [],
    hardToUndo: { value: true, reason: "deletes an org's data" },
    actElsewhere: { where: "your terminal", what: "yarn purge:org --apply" },
  }),
  one("campaign-foundry", "required-check-on-main", {
    question: "Add a required status check to main",
    options: [
      { key: "a", text: "A separate ruleset", cost: UNRECORDED },
      { key: "b", text: "Edit the existing ruleset", cost: UNRECORDED },
    ],
    recommended: { option: "a", reason: UNRECORDED },
    actElsewhere: {
      where: "session campaign-foundry",
      what: "allow the ruleset edit at its prompt",
    },
  }),
  {
    id: "give-up-bound",
    project: "gate-lock",
    revisions: [
      decision({
        ...GIVE_UP,
        question:
          "Bound a 13-minute give-up at about a minute, accepting it can fire on a slow supervisor?",
        options: [
          { key: "a", text: "Count sleeps", cost: UNRECORDED },
          { key: "b", text: "Leave it", cost: UNRECORDED },
          { key: "c", text: "Wall clock", cost: UNRECORDED },
        ],
      }),
      decision({
        ...GIVE_UP,
        question:
          "Bound a 13-minute give-up at about a minute, accepting it can fire on a slow supervisor?",
        options: [
          {
            key: "a",
            text: "Count sleeps, narrowed for the reported window",
            cost: UNRECORDED,
          },
          { key: "b", text: "Leave it", cost: UNRECORDED },
          { key: "c", text: "Wall clock", cost: UNRECORDED },
        ],
        changeNote: "narrowed after the session reported a window",
      }),
    ],
    states: [
      state({
        state: "delegated",
        source: "session",
        option: "a",
        by: "fleet session",
        words: undefined,
      }),
      state({
        state: "delegated",
        source: "session",
        revision: 2,
        expectedEntries: 1,
        option: "a",
        by: "fleet session",
        words: undefined,
      }),
    ],
  },
  one("gate-lock", "heartbeat-lock", {
    question: "Close the heartbeat's check-and-write window with a lock?",
    options: YES_NO,
    hardToUndo: { value: "partly", reason: "a design change" },
  }),
  one(
    "fleet",
    "test-db-switch-hold",
    {
      question: "Keep the test-database switch on hold?",
      options: [
        { key: "hold", text: "Hold", cost: UNRECORDED },
        { key: "lift", text: "Lift", cost: UNRECORDED },
      ],
      recommended: {
        option: "lift",
        reason: "the measurement did not support the hold",
      },
    },
    [
      state({
        state: "answered",
        option: "hold",
        by: "fleet session",
        words: UNRECORDED,
      }),
      state({
        option: "lift",
        expectedEntries: 1,
        by: "fleet session",
        words: UNRECORDED,
      }),
    ],
  ),
  one("fleet", "offsite-backup-cost", {
    question: "Pay for an off-machine copy of production data?",
    options: [
      { key: "yes", text: "Yes", cost: "A monthly charge" },
      {
        key: "no",
        text: "No",
        cost: "Production data has no copy off the machine",
      },
    ],
    recommended: { option: "yes", reason: "yes for production only" },
    hardToUndo: { value: false, reason: "no, but it costs money monthly" },
  }),
  one("client-portal", "rls-before-first-client", {
    question:
      "Do the database role and row-level security work (#71) before the first real client?",
    options: YES_NO,
    recommended: { option: "yes", reason: UNRECORDED },
  }),
  one("client-portal", "delete-three-branches", {
    question:
      "Delete two merged branches and one closed branch with its worktree?",
    options: YES_NO,
    recommended: { option: "yes", reason: UNRECORDED },
    hardToUndo: {
      value: "partly",
      reason: "the deletion cannot be undone; the work is merged or obsolete",
    },
  }),
  one("waves", "install-sync-agent", {
    question: "Install the sync agent on the owner's laptop?",
    options: [
      { key: "yes", text: "Yes", cost: "A change to your machine" },
      { key: "no", text: "No", cost: UNRECORDED },
    ],
  }),
  one("fleet", "backup-job-in-freeze", {
    question:
      "Deploy hexagen-monaco's backup job to production during the freeze?",
    options: YES_NO,
    recommended: { option: "no", reason: "the standing freeze covers it" },
    hardToUndo: { value: true, reason: "a production deployment" },
  }),
  one(
    "fleet",
    "clean-merged-worktrees",
    {
      shape: "instruction",
      question: "Clean up worktrees already merged via a PR",
      options: [],
      hardToUndo: { value: "partly", reason: "deleting; branches kept" },
      appliesTo: [
        "campaign-foundry",
        "client-portal",
        "hexagen-monaco",
        "waves",
        "gate-lock",
      ],
    },
    [
      state({
        by: "fleet session",
        words: "Yes clean up worktrees that have already been merged via a PR.",
      }),
    ],
  ),
];
