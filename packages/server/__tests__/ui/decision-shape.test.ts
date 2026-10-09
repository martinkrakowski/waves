import { describe, expect, it } from "vitest";

import { drawableDecision } from "../../public/decision.js";

import {
  decisionEntry,
  decisionRevision,
  decisionResponse,
  inboxHead,
  storedRevision,
} from "./fixtures.js";

const PROJECT = "alpha";
const ID = "d1";

/**
 * One bad response per rule, as `inbox-shape.test.ts` does it: each entry is an
 * object literal in an `unknown` slot, so TypeScript does not refuse the invalid
 * field override before the test ever runs.
 */
const INVALID: readonly (readonly [string, unknown])[] = [
  ["a head that is null", { ...decisionResponse(), head: null }],
  [
    "a head whose project does not match",
    { ...decisionResponse(), head: { ...inboxHead(), project: "beta" } },
  ],
  [
    "a head whose id does not match",
    { ...decisionResponse(), head: { ...inboxHead(), id: "other" } },
  ],
  [
    "a head whose id is not a valid lane id",
    { ...decisionResponse(), head: { ...inboxHead(), id: "A b" } },
  ],
  [
    "a head with a shape outside the three",
    { ...decisionResponse(), head: { ...inboxHead(), shape: "maybe" } },
  ],
  [
    "a head with a state outside the seven",
    { ...decisionResponse(), head: { ...inboxHead(), state: "maybe" } },
  ],
  [
    "a head with a source outside the two",
    {
      ...decisionResponse(),
      head: { ...inboxHead(), source: "maybe" },
    },
  ],
  [
    "a head with a group outside the four",
    { ...decisionResponse(), head: { ...inboxHead(), group: "nope" } },
  ],
  [
    "a waiting head whose state is approved",
    {
      ...decisionResponse(),
      head: { ...inboxHead(), group: "waiting", state: "approved" },
    },
  ],
  [
    "a reported head with no source",
    {
      ...decisionResponse(),
      head: {
        ...inboxHead(),
        group: "reported",
        state: "approved",
        source: undefined,
      },
    },
  ],
  [
    "a reported head whose source is session",
    {
      ...decisionResponse(),
      head: {
        ...inboxHead(),
        group: "reported",
        state: "approved",
        source: "session",
      },
    },
  ],
  [
    "a head with a time that is not a date",
    { ...decisionResponse(), head: { ...inboxHead(), at: "not a date" } },
  ],
  [
    "a head with a door value that is neither true, false nor partly",
    {
      ...decisionResponse(),
      head: { ...inboxHead(), door: { value: "half" } },
    },
  ],
  ["an empty revisions array", { ...decisionResponse(), revisions: [] }],
  [
    "a revision with duplicate option keys",
    {
      ...decisionResponse(),
      revisions: [
        {
          ...storedRevision(),
          decision: {
            ...decisionRevision(),
            options: [
              { key: "a", text: "Yes", cost: "C1" },
              { key: "a", text: "No", cost: "C2" },
            ],
          },
        },
      ],
    },
  ],
  [
    "an action revision without actElsewhere",
    {
      ...decisionResponse(),
      head: inboxHead({ shape: "action" }),
      revisions: [
        {
          ...storedRevision(),
          decision: { ...decisionRevision(), shape: "action", options: [] },
        },
      ],
    },
  ],
  [
    "a choice revision with only one option",
    {
      ...decisionResponse(),
      revisions: [
        {
          ...storedRevision(),
          decision: {
            ...decisionRevision(),
            options: [{ key: "a", text: "Yes", cost: "C1" }],
          },
        },
      ],
    },
  ],
  ["entries that are not a list", { ...decisionResponse(), entries: "no" }],
  [
    "revisions whose first number is not 1",
    {
      ...decisionResponse(),
      revisions: [{ ...storedRevision(), revision: 2 }],
    },
  ],
  [
    "revisions whose numbers are not in order",
    {
      ...decisionResponse(),
      head: inboxHead({ revision: 2, revisions: 2 }),
      revisions: [
        { ...storedRevision(), revision: 2 },
        {
          ...storedRevision(),
          revision: 1,
          receivedAt: "2026-10-09T12:00:00Z",
        },
      ],
    },
  ],
  [
    "a revision whose number skips",
    {
      ...decisionResponse(),
      head: inboxHead({ revision: 3, revisions: 3 }),
      revisions: [
        { ...storedRevision(), revision: 1 },
        {
          ...storedRevision(),
          revision: 3,
          receivedAt: "2026-10-09T12:00:00Z",
        },
      ],
    },
  ],
  [
    "a revision with a non-integer number",
    {
      ...decisionResponse(),
      revisions: [{ ...storedRevision(), revision: 1.5 }],
    },
  ],
  [
    "a revision with a receivedAt that is not a date",
    {
      ...decisionResponse(),
      revisions: [{ ...storedRevision(), receivedAt: "not a date" }],
    },
  ],
  [
    "a revision whose decision's project does not match",
    {
      ...decisionResponse(),
      revisions: [
        {
          ...storedRevision(),
          decision: { ...decisionRevision(), project: "beta" },
        },
      ],
    },
  ],
  [
    "a revision whose decision's id does not match",
    {
      ...decisionResponse(),
      revisions: [
        {
          ...storedRevision(),
          decision: { ...decisionRevision(), id: "other" },
        },
      ],
    },
  ],
  [
    "a revision with a bad schema",
    {
      ...decisionResponse(),
      revisions: [
        {
          ...storedRevision(),
          decision: { ...decisionRevision(), schema: "waves/v1" },
        },
      ],
    },
  ],
  [
    "a revision with a bad kind",
    {
      ...decisionResponse(),
      revisions: [
        {
          ...storedRevision(),
          decision: { ...decisionRevision(), kind: "event" },
        },
      ],
    },
  ],
  [
    "a revision whose decision has a shape outside the three",
    {
      ...decisionResponse(),
      revisions: [
        {
          ...storedRevision(),
          decision: { ...decisionRevision(), shape: "maybe" },
        },
      ],
    },
  ],
  [
    "a revision whose decision has an invalid hardToUndo value",
    {
      ...decisionResponse(),
      revisions: [
        {
          ...storedRevision(),
          decision: { ...decisionRevision(), hardToUndo: { value: "half" } },
        },
      ],
    },
  ],
  [
    "a revision whose decision has an invalid decider",
    {
      ...decisionResponse(),
      revisions: [
        {
          ...storedRevision(),
          decision: { ...decisionRevision(), decider: "maybe" },
        },
      ],
    },
  ],
  [
    "a revision whose commits are not all strings",
    {
      ...decisionResponse(),
      revisions: [
        {
          ...storedRevision(),
          decision: { ...decisionRevision(), commits: ["ok", 42] },
        },
      ],
    },
  ],
  [
    "a revision whose decision has a bad raisedAt",
    {
      ...decisionResponse(),
      revisions: [
        {
          ...storedRevision(),
          decision: { ...decisionRevision(), raisedAt: "not a date" },
        },
      ],
    },
  ],
  [
    "a revision whose appliesTo has a bad id",
    {
      ...decisionResponse(),
      revisions: [
        {
          ...storedRevision(),
          decision: { ...decisionRevision(), appliesTo: ["A b"] },
        },
      ],
    },
  ],
  [
    "evidence with a javascript: href",
    {
      ...decisionResponse(),
      revisions: [
        {
          ...storedRevision(),
          decision: {
            ...decisionRevision(),
            evidence: [{ label: "x", href: "javascript:alert(1)" }],
          },
        },
      ],
    },
  ],
  [
    "evidence with an http: href",
    {
      ...decisionResponse(),
      revisions: [
        {
          ...storedRevision(),
          decision: {
            ...decisionRevision(),
            evidence: [{ label: "x", href: "http://evil.example" }],
          },
        },
      ],
    },
  ],
  [
    "a recommended option that is not a key of this revision",
    {
      ...decisionResponse(),
      revisions: [
        {
          ...storedRevision(),
          decision: {
            ...decisionRevision(),
            recommended: { option: "z", reason: "no match" },
          },
        },
      ],
    },
  ],
  [
    "an actElsewhere that is not an object",
    {
      ...decisionResponse(),
      revisions: [
        {
          ...storedRevision(),
          decision: { ...decisionRevision(), actElsewhere: "nowhere" },
        },
      ],
    },
  ],
  [
    "a revision whose refs carries a bad wave id",
    {
      ...decisionResponse(),
      revisions: [
        {
          ...storedRevision(),
          decision: { ...decisionRevision(), refs: { wave: "A b" } },
        },
      ],
    },
  ],
  [
    "a revision whose refs carries a bad pr",
    {
      ...decisionResponse(),
      revisions: [
        {
          ...storedRevision(),
          decision: { ...decisionRevision(), refs: { pr: 0 } },
        },
      ],
    },
  ],
  [
    "an entry whose revision is not among the revisions",
    {
      ...decisionResponse(),
      entries: [{ ...decisionEntry(), revision: 5 }],
    },
  ],
  [
    "an entry with a state outside the seven",
    {
      ...decisionResponse(),
      entries: [{ ...decisionEntry(), state: "maybe" }],
    },
  ],
  [
    "an entry with a source outside the two",
    {
      ...decisionResponse(),
      entries: [{ ...decisionEntry(), source: "maybe" }],
    },
  ],
  [
    "an entry with a receivedAt that is not a date",
    {
      ...decisionResponse(),
      entries: [{ ...decisionEntry(), receivedAt: "not a date" }],
    },
  ],
  [
    "an entry with an at that is not a date",
    {
      ...decisionResponse(),
      entries: [{ ...decisionEntry(), at: "not a date" }],
    },
  ],
  [
    "an entry whose supersededBy is not a lane id",
    {
      ...decisionResponse(),
      entries: [{ ...decisionEntry(), supersededBy: "A b" }],
    },
  ],
  [
    "a decision with options that are not a list",
    {
      ...decisionResponse(),
      revisions: [
        {
          ...storedRevision(),
          decision: { ...decisionRevision(), options: "no" },
        },
      ],
    },
  ],
  [
    "an entry whose words is not a string",
    {
      ...decisionResponse(),
      entries: [{ ...decisionEntry(), words: 42 }],
    },
  ],
  [
    "a delegated entry with neither option nor words",
    {
      ...decisionResponse(),
      entries: [
        {
          ...decisionEntry(),
          state: "delegated",
          option: undefined,
          words: undefined,
        },
      ],
    },
  ],
  [
    "a withdrawn entry with no reason",
    {
      ...decisionResponse(),
      entries: [
        {
          ...decisionEntry(),
          state: "withdrawn",
          source: "session",
          reason: undefined,
        },
      ],
    },
  ],
  [
    "a superseded entry with no supersededBy",
    {
      ...decisionResponse(),
      entries: [
        {
          ...decisionEntry(),
          state: "superseded",
          source: "session",
          supersededBy: undefined,
        },
      ],
    },
  ],
  [
    "an approved entry with source session",
    {
      ...decisionResponse(),
      entries: [{ ...decisionEntry(), state: "approved", source: "session" }],
    },
  ],
  [
    "an entry whose reason is not a string",
    {
      ...decisionResponse(),
      entries: [{ ...decisionEntry(), reason: 42 }],
    },
  ],
  [
    "a head whose revision does not match the last revision",
    {
      ...decisionResponse({
        head: inboxHead({ revision: 1, revisions: 2 }),
        revisions: [
          storedRevision({ revision: 1 }),
          storedRevision({ revision: 2, receivedAt: "2026-10-09T12:00:00Z" }),
        ],
      }),
    },
  ],
  [
    "a head whose revisions count does not match the array",
    {
      ...decisionResponse({
        head: inboxHead({ revision: 1, revisions: 2 }),
        revisions: [storedRevision({ revision: 1 })],
      }),
    },
  ],
  [
    "a head whose textSha256 does not match the last revision",
    {
      ...decisionResponse({
        head: inboxHead({ textSha256: "a".repeat(64) }),
      }),
    },
  ],
  [
    "a head whose entries count does not match the array",
    {
      ...decisionResponse({
        head: inboxHead({ entries: 1 }),
      }),
    },
  ],
];

describe("drawableDecision", () => {
  it("takes a minimal decision response", () => {
    expect(drawableDecision(decisionResponse(), PROJECT, ID)).toBe(true);
  });

  it("takes a decision with two revisions and an entry on the first", () => {
    expect(
      drawableDecision(
        decisionResponse({
          head: inboxHead({ revision: 2, revisions: 2, entries: 1 }),
          revisions: [
            storedRevision({ revision: 1 }),
            storedRevision({ revision: 2, receivedAt: "2026-10-09T12:00:00Z" }),
          ],
          entries: [decisionEntry({ revision: 1 })],
        }),
        PROJECT,
        ID,
      ),
    ).toBe(true);
  });

  it("takes a history decision with any state", () => {
    expect(
      drawableDecision(
        decisionResponse({
          head: inboxHead({
            group: "history",
            state: "approved",
            source: "reported",
          }),
        }),
        PROJECT,
        ID,
      ),
    ).toBe(true);
  });

  it("takes a decision with all optional fields set", () => {
    expect(
      drawableDecision(
        decisionResponse({
          revisions: [
            storedRevision({
              decision: decisionRevision({
                recommended: { option: "a", reason: "best" },
                actElsewhere: { where: "terminal", what: "run this" },
                evidence: [
                  { label: "PR", href: "https://github.com/acme/waves" },
                ],
                refs: { wave: "w-1", lane: "l-1", pr: 42 },
                changeNote: "narrowed the options",
              }),
            }),
          ],
        }),
        PROJECT,
        ID,
      ),
    ).toBe(true);
  });

  it("takes a head with every optional field set", () => {
    expect(
      drawableDecision(
        decisionResponse({
          head: inboxHead({
            group: "reported",
            state: "approved",
            source: "reported",
            entries: 1,
            from: "fleet",
            earlierAnswer: {
              state: "declined",
              source: "reported",
              at: "2026-10-08T13:00:00Z",
              by: "owner",
              words: "no",
            },
            coveredAnswer: {
              state: "declined",
              source: "reported",
              at: "2026-10-08T13:00:00Z",
              by: "owner",
              option: "b",
            },
          }),
          entries: [decisionEntry({ revision: 1 })],
        }),
        PROJECT,
        ID,
      ),
    ).toBe(true);
  });

  it("takes a closed head with a covered answer", () => {
    expect(
      drawableDecision(
        decisionResponse({
          head: inboxHead({
            group: "closed",
            state: "withdrawn",
            entries: 2,
            coveredAnswer: {
              state: "approved",
              source: "reported",
              at: "2026-10-08T13:00:00Z",
              by: "owner",
              words: "yes",
            },
          }),
          entries: [
            decisionEntry({
              state: "approved",
              source: "reported",
              revision: 1,
              words: "yes",
            }),
            decisionEntry({
              state: "withdrawn",
              source: "session",
              revision: 1,
              reason: "gone",
            }),
          ],
        }),
        PROJECT,
        ID,
      ),
    ).toBe(true);
  });

  it.each(INVALID)("refuses %s", (_rule, response) => {
    expect(drawableDecision(response, PROJECT, ID)).toBe(false);
  });

  it("refuses null, a string, a number and nothing at all", () => {
    expect(drawableDecision(undefined, PROJECT, ID)).toBe(false);
    expect(drawableDecision(null, PROJECT, ID)).toBe(false);
    expect(drawableDecision(7, PROJECT, ID)).toBe(false);
    expect(drawableDecision("decision", PROJECT, ID)).toBe(false);
  });
});
