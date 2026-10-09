import { describe, expect, it } from "vitest";

import { drawableProjectEvents } from "../../public/project-events.js";

import { inboxEvent, projectEventsView } from "./fixtures.js";

const PROJECT = "alpha";

const TOO_MANY = Array.from({ length: 201 }, () => inboxEvent());

/**
 * One bad response per rule, as `project-inbox-shape.test.ts` does it: each
 * entry is an object literal in an `unknown` slot, so TypeScript does not refuse
 * the invalid field override before the test ever runs.
 */
const INVALID: readonly (readonly [string, unknown])[] = [
  ["null", null],
  ["a number", 7],
  ["a boolean", true],
  ["nothing at all", undefined],
  ["an array", [inboxEvent(), inboxEvent()]],
  ["a view whose events is not a list", { events: "no" }],
  ["a view whose events is null", { ...projectEventsView(), events: null }],
  ["more than 200 events", { ...projectEventsView(), events: TOO_MANY }],
  ["an event that is null", { ...projectEventsView(), events: [null] }],
  ["an event that is a number", { ...projectEventsView(), events: [42] }],
  [
    "an event whose id is not a string",
    {
      ...projectEventsView(),
      events: [{ ...inboxEvent(), id: 42 }],
    },
  ],
  [
    "an event with an empty id",
    { ...projectEventsView(), events: [{ ...inboxEvent(), id: "" }] },
  ],
  [
    "an event with a receivedAt that is not a date",
    {
      ...projectEventsView(),
      events: [{ ...inboxEvent(), receivedAt: "not a date" }],
    },
  ],
  [
    "an event whose event is null",
    { ...projectEventsView(), events: [{ ...inboxEvent(), event: null }] },
  ],
  [
    "an event whose event is a number",
    { ...projectEventsView(), events: [{ ...inboxEvent(), event: 42 }] },
  ],
  [
    "an event whose kind is not event",
    {
      ...projectEventsView(),
      events: [
        {
          ...inboxEvent(),
          event: { ...inboxEvent().event, kind: "decision" },
        },
      ],
    },
  ],
  [
    "an event whose project is not the one asked for",
    {
      ...projectEventsView(),
      events: [
        {
          ...inboxEvent(),
          event: { ...inboxEvent().event, project: "beta" },
        },
      ],
    },
  ],
  [
    "an event whose topic is not a string",
    {
      ...projectEventsView(),
      events: [
        {
          ...inboxEvent(),
          event: { ...inboxEvent().event, topic: 42 },
        },
      ],
    },
  ],
  [
    "an event whose topic is not lower-case letters and hyphens",
    {
      ...projectEventsView(),
      events: [
        {
          ...inboxEvent(),
          event: { ...inboxEvent().event, topic: "Bad" },
        },
      ],
    },
  ],
  [
    "an event whose text is not a string",
    {
      ...projectEventsView(),
      events: [
        {
          ...inboxEvent(),
          event: { ...inboxEvent().event, text: 42 },
        },
      ],
    },
  ],
  [
    "an event with empty text",
    {
      ...projectEventsView(),
      events: [
        {
          ...inboxEvent(),
          event: { ...inboxEvent().event, text: "" },
        },
      ],
    },
  ],
  [
    "an event whose detail is not a string",
    {
      ...projectEventsView(),
      events: [
        {
          ...inboxEvent(),
          event: { ...inboxEvent().event, detail: 42 },
        },
      ],
    },
  ],
  [
    "an event whose at is not a date",
    {
      ...projectEventsView(),
      events: [
        {
          ...inboxEvent(),
          event: { ...inboxEvent().event, at: "not a date" },
        },
      ],
    },
  ],
  [
    "an event whose refs is null",
    {
      ...projectEventsView(),
      events: [
        {
          ...inboxEvent(),
          event: { ...inboxEvent().event, refs: null },
        },
      ],
    },
  ],
  [
    "an event whose refs is not an object",
    {
      ...projectEventsView(),
      events: [
        {
          ...inboxEvent(),
          event: { ...inboxEvent().event, refs: "bad" },
        },
      ],
    },
  ],
  [
    "an event whose refs carries a bad wave",
    {
      ...projectEventsView(),
      events: [
        {
          ...inboxEvent(),
          event: { ...inboxEvent().event, refs: { wave: "A b" } },
        },
      ],
    },
  ],
  [
    "an event whose refs carries a bad lane",
    {
      ...projectEventsView(),
      events: [
        {
          ...inboxEvent(),
          event: { ...inboxEvent().event, refs: { lane: "A b" } },
        },
      ],
    },
  ],
  [
    "an event whose refs carries a pr of zero",
    {
      ...projectEventsView(),
      events: [
        {
          ...inboxEvent(),
          event: { ...inboxEvent().event, refs: { pr: 0 } },
        },
      ],
    },
  ],
  [
    "an event whose refs carries a non-integer pr",
    {
      ...projectEventsView(),
      events: [
        {
          ...inboxEvent(),
          event: { ...inboxEvent().event, refs: { pr: 1.5 } },
        },
      ],
    },
  ],
];

describe("drawableProjectEvents", () => {
  it("takes an empty events list", () => {
    expect(drawableProjectEvents({ events: [] }, PROJECT)).toBe(true);
  });

  it("takes an event without optional fields", () => {
    expect(drawableProjectEvents(projectEventsView(), PROJECT)).toBe(true);
  });

  it("takes an event with a string detail", () => {
    expect(
      drawableProjectEvents(
        projectEventsView({
          events: [
            inboxEvent({ event: { ...inboxEvent().event, detail: "more" } }),
          ],
        }),
        PROJECT,
      ),
    ).toBe(true);
  });

  it("takes an event with a full refs object", () => {
    expect(
      drawableProjectEvents(
        projectEventsView({
          events: [
            inboxEvent({
              event: {
                ...inboxEvent().event,
                refs: { wave: "w-1", lane: "l-1", pr: 1 },
              },
            }),
          ],
        }),
        PROJECT,
      ),
    ).toBe(true);
  });

  it("takes an event with a minimal refs object", () => {
    expect(
      drawableProjectEvents(
        projectEventsView({
          events: [inboxEvent({ event: { ...inboxEvent().event, refs: {} } })],
        }),
        PROJECT,
      ),
    ).toBe(true);
  });

  it.each(INVALID)("refuses %s", (_rule, view) => {
    expect(drawableProjectEvents(view, PROJECT)).toBe(false);
  });

  it("refuses a number, a boolean and nothing at all", () => {
    expect(drawableProjectEvents(7, PROJECT)).toBe(false);
    expect(drawableProjectEvents(true, PROJECT)).toBe(false);
    expect(drawableProjectEvents(undefined, PROJECT)).toBe(false);
  });
});
