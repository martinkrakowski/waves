import { describe, expect, it } from "vitest";

import { drawableInbox } from "../../public/inbox.js";

import { inboxCounts, inboxHead, inboxProject, inboxView } from "./fixtures.js";

/**
 * One invalid view per rule, and the rule it breaks. Each bad entry is an object
 * literal assigned to a `unknown` slot, so TypeScript does not refuse the invalid
 * field override before the test ever runs.
 */
const INVALID: readonly (readonly [string, unknown])[] = [
  ["null", null],
  ["a string", "inbox"],
  ["no projects", {}],
  ["projects that are not a list", { ...inboxView(), projects: {} }],
  ["a project that is null", { ...inboxView(), projects: [null] }],
  [
    "a project with a bad id",
    { ...inboxView(), projects: [{ ...inboxProject(), id: "A b" }] },
  ],
  [
    "a project with no id",
    {
      ...inboxView(),
      projects: [{ name: "Alpha", counts: inboxCounts(), decisions: [] }],
    },
  ],
  [
    "a project with no name",
    {
      ...inboxView(),
      projects: [{ id: "alpha", counts: inboxCounts(), decisions: [] }],
    },
  ],
  [
    "a project with no counts",
    {
      ...inboxView(),
      projects: [{ id: "alpha", name: "Alpha", decisions: [] }],
    },
  ],
  [
    "a project with a non-integer waiting",
    {
      ...inboxView(),
      projects: [
        { ...inboxProject(), counts: { ...inboxCounts(), waiting: 1.5 } },
      ],
    },
  ],
  [
    "a project with a negative closed",
    {
      ...inboxView(),
      projects: [
        { ...inboxProject(), counts: { ...inboxCounts(), closed: -1 } },
      ],
    },
  ],
  [
    "a project with oneWay above waiting",
    {
      ...inboxView(),
      projects: [
        {
          ...inboxProject(),
          counts: { ...inboxCounts(), waiting: 1, oneWay: 2 },
        },
      ],
    },
  ],
  [
    "a project with no decisions",
    { ...inboxView(), projects: [{ ...inboxProject(), decisions: undefined }] },
  ],
  [
    "a project with decisions that are not a list",
    { ...inboxView(), projects: [{ ...inboxProject(), decisions: "no" }] },
  ],
  [
    "a head that is null",
    { ...inboxView(), projects: [{ ...inboxProject(), decisions: [null] }] },
  ],
  [
    "a head with a project id the app does not own",
    {
      ...inboxView(),
      projects: [
        inboxProject({ decisions: [{ ...inboxHead(), project: "A b" }] }),
      ],
    },
  ],
  [
    "a head with an id the app does not own",
    {
      ...inboxView(),
      projects: [inboxProject({ decisions: [{ ...inboxHead(), id: "w 3" }] })],
    },
  ],
  [
    "a head with no question",
    {
      ...inboxView(),
      projects: [
        {
          ...inboxProject(),
          decisions: [{ ...inboxHead(), question: undefined }],
        },
      ],
    },
  ],
  [
    "a head with a shape outside the three",
    {
      ...inboxView(),
      projects: [
        {
          ...inboxProject(),
          decisions: [{ ...inboxHead(), shape: "maybe" }],
        },
      ],
    },
  ],
  [
    "a head with no door",
    {
      ...inboxView(),
      projects: [
        {
          ...inboxProject(),
          decisions: [{ ...inboxHead(), door: undefined }],
        },
      ],
    },
  ],
  [
    "a head with a door value that is neither true, false nor partly",
    {
      ...inboxView(),
      projects: [
        {
          ...inboxProject(),
          decisions: [{ ...inboxHead(), door: { value: "half" } }],
        },
      ],
    },
  ],
  [
    "a head with a door reason that is not a string",
    {
      ...inboxView(),
      projects: [
        {
          ...inboxProject(),
          decisions: [{ ...inboxHead(), door: { value: true, reason: 42 } }],
        },
      ],
    },
  ],
  [
    "a head with a decider outside the two",
    {
      ...inboxView(),
      projects: [
        {
          ...inboxProject(),
          decisions: [{ ...inboxHead(), decider: "maybe" }],
        },
      ],
    },
  ],
  [
    "a head with a non-integer revision",
    {
      ...inboxView(),
      projects: [
        {
          ...inboxProject(),
          decisions: [{ ...inboxHead(), revision: 1.5 }],
        },
      ],
    },
  ],
  [
    "a head with no textSha256",
    {
      ...inboxView(),
      projects: [
        {
          ...inboxProject(),
          decisions: [{ ...inboxHead(), textSha256: undefined }],
        },
      ],
    },
  ],
  [
    "a head with a non-integer entries",
    {
      ...inboxView(),
      projects: [
        {
          ...inboxProject(),
          decisions: [{ ...inboxHead(), entries: 1.5 }],
        },
      ],
    },
  ],
  [
    "a head with a state outside the seven",
    {
      ...inboxView(),
      projects: [
        {
          ...inboxProject(),
          decisions: [{ ...inboxHead(), state: "maybe" }],
        },
      ],
    },
  ],
  [
    "a head with a source outside the two",
    {
      ...inboxView(),
      projects: [
        {
          ...inboxProject(),
          decisions: [{ ...inboxHead(), source: "maybe" }],
        },
      ],
    },
  ],
  [
    "a head with no at",
    {
      ...inboxView(),
      projects: [
        {
          ...inboxProject(),
          decisions: [{ ...inboxHead(), at: undefined }],
        },
      ],
    },
  ],
  [
    "a head with a group the inbox does not draw",
    {
      ...inboxView(),
      projects: [
        {
          ...inboxProject(),
          decisions: [{ ...inboxHead(), group: "history" }],
        },
      ],
    },
  ],
  [
    "a head with an actElsewhere that is not an object",
    {
      ...inboxView(),
      projects: [
        {
          ...inboxProject(),
          decisions: [{ ...inboxHead(), actElsewhere: "nowhere" }],
        },
      ],
    },
  ],
  [
    "a head with an earlierAnswer that is not an answer",
    {
      ...inboxView(),
      projects: [
        {
          ...inboxProject(),
          decisions: [{ ...inboxHead(), earlierAnswer: { state: "maybe" } }],
        },
      ],
    },
  ],
  [
    "a head with a from that is not a project id",
    {
      ...inboxView(),
      projects: [
        {
          ...inboxProject(),
          decisions: [{ ...inboxHead(), from: "A b" }],
        },
      ],
    },
  ],
];

describe("drawableInbox", () => {
  it("takes an empty inbox", () => {
    expect(drawableInbox(inboxView())).toBe(true);
  });

  it("takes a project with everything a head can carry", () => {
    expect(
      drawableInbox(
        inboxView({
          projects: [
            inboxProject({
              id: "alpha",
              name: "Alpha",
              counts: { waiting: 3, oneWay: 1, reported: 2, closed: 1 },
              decisions: [
                inboxHead({
                  shape: "action",
                  door: { value: "partly", reason: "design change" },
                  decider: "delegated",
                  revision: 2,
                  revisions: 2,
                  entries: 1,
                  state: "delegated",
                  source: "session",
                  group: "waiting",
                  actElsewhere: { where: "terminal", what: "run this" },
                  earlierAnswer: {
                    state: "approved",
                    source: "reported",
                    at: "2026-10-08T13:00:00Z",
                    by: "owner",
                    words: "yes",
                  },
                  coveredAnswer: {
                    state: "declined",
                    source: "session",
                    at: "2026-10-08T13:00:00Z",
                    by: "session",
                  },
                  from: "fleet",
                }),
              ],
            }),
          ],
        }),
      ),
    ).toBe(true);
  });

  it.each(INVALID)("refuses %s", (_rule, view) => {
    expect(drawableInbox(view)).toBe(false);
  });

  it("refuses a number, a boolean and nothing at all", () => {
    expect(drawableInbox(undefined)).toBe(false);
    expect(drawableInbox(7)).toBe(false);
    expect(drawableInbox(true)).toBe(false);
  });
});
