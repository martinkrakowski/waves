import { describe, expect, it } from "vitest";

import { drawableProjectInbox } from "../../public/project-inbox.js";

import { inboxCounts, inboxHead, projectInboxView } from "./fixtures.js";

/**
 * One invalid view per rule, and the rule it breaks. Each bad value is an object
 * literal assigned to a `unknown` slot, so TypeScript does not refuse the invalid
 * field override before the test ever runs.
 */
const INVALID: readonly (readonly [string, unknown])[] = [
  ["null", null],
  ["a number", 7],
  ["a boolean", true],
  ["nothing at all", undefined],
  ["a project that is null", { ...projectInboxView(), project: null }],
  ["a project that is a string", { ...projectInboxView(), project: "alpha" }],
  ["a view with no project", { counts: inboxCounts(), decisions: [] }],
  [
    "a project with no id",
    { project: { name: "Alpha" }, counts: inboxCounts(), decisions: [] },
  ],
  [
    "a project the page was not opened for",
    projectInboxView({ project: { id: "beta", name: "Beta" } }),
  ],
  [
    "a project with no name",
    { id: "alpha", counts: inboxCounts(), decisions: [] },
  ],
  [
    "a project with a repo that is not a string",
    {
      ...projectInboxView(),
      project: { id: "alpha", name: "Alpha", repo: 42 },
    },
  ],
  [
    "a project with no counts",
    { project: { id: "alpha", name: "Alpha" }, decisions: [] },
  ],
  ["a project whose counts is null", { ...projectInboxView(), counts: null }],
  [
    "a project with a negative waiting",
    projectInboxView({ counts: { ...inboxCounts(), waiting: -1 } }),
  ],
  [
    "a project with a non-integer oneWay",
    projectInboxView({ counts: { ...inboxCounts(), oneWay: 1.5 } }),
  ],
  [
    "a project with a non-integer reported",
    projectInboxView({ counts: { ...inboxCounts(), reported: 1.5 } }),
  ],
  [
    "a project with a negative closed",
    projectInboxView({ counts: { ...inboxCounts(), closed: -1 } }),
  ],
  [
    "a project with oneWay above waiting",
    projectInboxView({
      counts: { waiting: 1, oneWay: 2, reported: 0, closed: 0 },
    }),
  ],
  ["decisions that are not a list", { ...projectInboxView(), decisions: "no" }],
  [
    "a project whose decisions is null",
    { ...projectInboxView(), decisions: null },
  ],
  ["a head that is null", { ...projectInboxView(), decisions: [null] }],
  [
    "a head with a project id the app does not own",
    {
      ...projectInboxView(),
      decisions: [{ ...inboxHead(), project: "A b" }],
    },
  ],
  [
    "a head with an id the app does not own",
    { ...projectInboxView(), decisions: [{ ...inboxHead(), id: "w 3" }] },
  ],
  [
    "a head with no question",
    {
      ...projectInboxView(),
      decisions: [{ ...inboxHead(), question: undefined }],
    },
  ],
  [
    "a head with a shape outside the three",
    {
      ...projectInboxView(),
      decisions: [{ ...inboxHead(), shape: "maybe" }],
    },
  ],
  [
    "a head with no door",
    { ...projectInboxView(), decisions: [{ ...inboxHead(), door: undefined }] },
  ],
  [
    "a head with a door value that is neither true, false nor partly",
    {
      ...projectInboxView(),
      decisions: [{ ...inboxHead(), door: { value: "half" } }],
    },
  ],
  [
    "a head with a decider outside the two",
    {
      ...projectInboxView(),
      decisions: [{ ...inboxHead(), decider: "maybe" }],
    },
  ],
  [
    "a head with a non-integer revision",
    {
      ...projectInboxView(),
      decisions: [{ ...inboxHead(), revision: 1.5 }],
    },
  ],
  [
    "a head at revision zero",
    {
      ...projectInboxView(),
      decisions: [{ ...inboxHead(), revision: 0, revisions: 2 }],
    },
  ],
  [
    "a head at a revision past its last",
    {
      ...projectInboxView(),
      decisions: [{ ...inboxHead(), revision: 3, revisions: 2 }],
    },
  ],
  [
    "a head with a non-integer entries",
    {
      ...projectInboxView(),
      decisions: [{ ...inboxHead(), entries: 1.5 }],
    },
  ],
  [
    "a head with no textSha256",
    {
      ...projectInboxView(),
      decisions: [{ ...inboxHead(), textSha256: undefined }],
    },
  ],
  [
    "a head with a state outside the seven",
    { ...projectInboxView(), decisions: [{ ...inboxHead(), state: "maybe" }] },
  ],
  [
    "a head with a source outside the two",
    {
      ...projectInboxView(),
      decisions: [{ ...inboxHead(), source: "maybe" }],
    },
  ],
  [
    "a head with no at",
    { ...projectInboxView(), decisions: [{ ...inboxHead(), at: undefined }] },
  ],
  [
    "a head with a time that is not one",
    {
      ...projectInboxView(),
      decisions: [{ ...inboxHead(), at: "not a date" }],
    },
  ],
  [
    "a head with a group outside the four",
    {
      ...projectInboxView(),
      decisions: [{ ...inboxHead(), group: "maybe" }],
    },
  ],
  [
    "a closed head whose state is open",
    {
      ...projectInboxView(),
      decisions: [{ ...inboxHead(), group: "closed", state: "open" }],
    },
  ],
  [
    "a waiting head whose state is approved",
    {
      ...projectInboxView(),
      decisions: [{ ...inboxHead(), group: "waiting", state: "approved" }],
    },
  ],
  [
    "a reported head with no source",
    {
      ...projectInboxView(),
      decisions: [{ ...inboxHead(), group: "reported", state: "approved" }],
    },
  ],
  [
    "a reported head whose state is withdrawn",
    {
      ...projectInboxView(),
      decisions: [{ ...inboxHead(), group: "reported", state: "withdrawn" }],
    },
  ],
  [
    "a head with an actElsewhere that is not an object",
    {
      ...projectInboxView(),
      decisions: [{ ...inboxHead(), actElsewhere: "nowhere" }],
    },
  ],
  [
    "a head with an earlierAnswer that is not an answer",
    {
      ...projectInboxView(),
      decisions: [{ ...inboxHead(), earlierAnswer: { state: "maybe" } }],
    },
  ],
  [
    "a head with an earlierAnswer that is null",
    {
      ...projectInboxView(),
      decisions: [{ ...inboxHead(), earlierAnswer: null }],
    },
  ],
  [
    "a head with an earlierAnswer that is not an object",
    {
      ...projectInboxView(),
      decisions: [{ ...inboxHead(), earlierAnswer: 42 }],
    },
  ],
  [
    "a head with a coveredAnswer whose source is outside the two",
    {
      ...projectInboxView(),
      decisions: [
        {
          ...inboxHead(),
          coveredAnswer: {
            state: "approved",
            source: "maybe",
            at: "2026-10-08T13:00:00Z",
            by: "owner",
          },
        },
      ],
    },
  ],
  [
    "a head with a from that is not a project id",
    { ...projectInboxView(), decisions: [{ ...inboxHead(), from: "A b" }] },
  ],
];

describe("drawableProjectInbox", () => {
  it("takes an empty project inbox", () => {
    expect(drawableProjectInbox(projectInboxView(), "alpha")).toBe(true);
  });

  it("takes a project whose repo is absent", () => {
    expect(
      drawableProjectInbox(
        projectInboxView({ project: { id: "alpha", name: "Alpha" } }),
        "alpha",
      ),
    ).toBe(true);
  });

  it("takes a history head, whose state any written state allows", () => {
    expect(
      drawableProjectInbox(
        projectInboxView({
          decisions: [inboxHead({ group: "history", state: "answered" })],
        }),
        "alpha",
      ),
    ).toBe(true);
  });

  it("takes a from head whose link the page resolves to its raiser", () => {
    expect(
      drawableProjectInbox(
        projectInboxView({
          decisions: [
            inboxHead({ project: "fleet", from: "fleet", group: "waiting" }),
          ],
        }),
        "alpha",
      ),
    ).toBe(true);
  });

  it("takes a head whose answer carries both words and an option", () => {
    expect(
      drawableProjectInbox(
        projectInboxView({
          decisions: [
            inboxHead({
              group: "reported",
              state: "answered",
              source: "reported",
              earlierAnswer: {
                state: "approved",
                source: "reported",
                at: "2026-10-08T13:00:00Z",
                by: "owner",
                words: "yes",
                option: "a",
              },
            }),
          ],
        }),
        "alpha",
      ),
    ).toBe(true);
  });

  it("takes heads across all four groups", () => {
    expect(
      drawableProjectInbox(
        projectInboxView({
          decisions: [
            inboxHead({ group: "waiting", state: "open" }),
            inboxHead({
              group: "reported",
              state: "approved",
              source: "reported",
            }),
            inboxHead({ group: "closed", state: "withdrawn" }),
            inboxHead({ group: "history", state: "answered" }),
          ],
        }),
        "alpha",
      ),
    ).toBe(true);
  });

  it.each(INVALID)("refuses %s", (_rule, view) => {
    expect(drawableProjectInbox(view, "alpha")).toBe(false);
  });

  it("refuses a number, a boolean and nothing at all", () => {
    expect(drawableProjectInbox(7, "alpha")).toBe(false);
    expect(drawableProjectInbox(true, "alpha")).toBe(false);
    expect(drawableProjectInbox(undefined, "alpha")).toBe(false);
  });
});
