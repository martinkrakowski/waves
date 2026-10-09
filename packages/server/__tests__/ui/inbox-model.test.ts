import { describe, expect, it } from "vitest";

import { countLine, inboxModel } from "../../public/views/inbox-model.js";

import { inboxCounts, inboxHead, inboxProject, inboxView } from "./fixtures.js";

import type { InboxProject } from "../../src/application/notice-read-model.js";

/** A project with one waiting head, so it sorts above one with none. */
function withWaiting(overrides: Partial<InboxProject>): InboxProject {
  return inboxProject({
    decisions: [inboxHead({ group: "waiting" })],
    counts: inboxCounts({ waiting: 1 }),
    ...overrides,
  });
}

describe("the inbox model", () => {
  describe("countLine", () => {
    it("names the four counts and never sums them", () => {
      expect(countLine({ waiting: 3, oneWay: 1, reported: 2, closed: 1 })).toBe(
        "3 waiting (1 one-way door) · 2 reported · 1 closed by a session",
      );
    });

    it("uses the singular 'one-way door' for one, plural for the rest", () => {
      expect(countLine({ waiting: 0, oneWay: 1, reported: 0, closed: 0 })).toBe(
        "0 waiting (1 one-way door) · 0 reported · 0 closed by a session",
      );
      expect(countLine({ waiting: 0, oneWay: 2, reported: 0, closed: 0 })).toBe(
        "0 waiting (2 one-way doors) · 0 reported · 0 closed by a session",
      );
      expect(countLine({ waiting: 0, oneWay: 0, reported: 0, closed: 0 })).toBe(
        "0 waiting (0 one-way doors) · 0 reported · 0 closed by a session",
      );
    });

    it("is the same wording at zero and at one", () => {
      expect(countLine({ waiting: 1, oneWay: 0, reported: 1, closed: 1 })).toBe(
        "1 waiting (0 one-way doors) · 1 reported · 1 closed by a session",
      );
    });
  });

  describe("sorting", () => {
    it("puts projects with decisions first, the empty ones last", () => {
      const model = inboxModel(
        inboxView({
          projects: [
            inboxProject({ id: "empty", name: "Empty" }),
            withWaiting({ id: "busy", name: "Busy" }),
          ],
        }),
      );
      expect(model.projects.map((p) => p.id)).toStrictEqual(["busy", "empty"]);
    });

    it("orders by oneWay descending, then waiting descending, then name", () => {
      const model = inboxModel(
        inboxView({
          projects: [
            withWaiting({
              id: "a",
              name: "A",
              counts: inboxCounts({ waiting: 1, oneWay: 0 }),
            }),
            withWaiting({
              id: "b",
              name: "B",
              counts: inboxCounts({ waiting: 2, oneWay: 0 }),
            }),
            withWaiting({
              id: "c",
              name: "C",
              counts: inboxCounts({ waiting: 2, oneWay: 1 }),
            }),
            withWaiting({
              id: "d",
              name: "D",
              counts: inboxCounts({ waiting: 3, oneWay: 1 }),
            }),
          ],
        }),
      );
      // D has the most oneWay and waiting; C has oneWay but fewer waiting;
      // B has more waiting but no oneWay; A has the least.
      expect(model.projects.map((p) => p.id)).toStrictEqual([
        "d",
        "c",
        "b",
        "a",
      ]);
    });

    it("breaks a tie on oneWay and waiting by name ascending", () => {
      const model = inboxModel(
        inboxView({
          projects: [
            withWaiting({ id: "b", name: "Bravo" }),
            withWaiting({ id: "a", name: "Alpha" }),
          ],
        }),
      );
      expect(model.projects.map((p) => p.name)).toStrictEqual([
        "Alpha",
        "Bravo",
      ]);
    });

    it("keeps the empty projects in the order the answer gave them", () => {
      const model = inboxModel(
        inboxView({
          projects: [
            inboxProject({ id: "z", name: "Zulu" }),
            inboxProject({ id: "a", name: "Alpha" }),
          ],
        }),
      );
      expect(model.projects.map((p) => p.id)).toStrictEqual(["z", "a"]);
    });
  });

  describe("grouping", () => {
    it("splits a project's heads into the three groups in order", () => {
      const model = inboxModel(
        inboxView({
          projects: [
            inboxProject({
              id: "alpha",
              name: "Alpha",
              decisions: [
                inboxHead({ id: "w", group: "waiting", state: "open" }),
                inboxHead({ id: "r", group: "reported", state: "approved" }),
                inboxHead({ id: "c", group: "closed", state: "withdrawn" }),
              ],
            }),
          ],
        }),
      );
      const project = model.projects[0]!;
      expect(project.waiting.map((h) => h.id)).toStrictEqual(["w"]);
      expect(project.reported.map((h) => h.id)).toStrictEqual(["r"]);
      expect(project.closed.map((h) => h.id)).toStrictEqual(["c"]);
    });

    it("keeps each group's order from the server", () => {
      const model = inboxModel(
        inboxView({
          projects: [
            inboxProject({
              id: "alpha",
              name: "Alpha",
              decisions: [
                inboxHead({ id: "w1", group: "waiting" }),
                inboxHead({ id: "w2", group: "waiting" }),
                inboxHead({ id: "r1", group: "reported" }),
              ],
            }),
          ],
        }),
      );
      const project = model.projects[0]!;
      expect(project.waiting.map((h) => h.id)).toStrictEqual(["w1", "w2"]);
      expect(project.reported.map((h) => h.id)).toStrictEqual(["r1"]);
      expect(project.closed.map((h) => h.id)).toStrictEqual([]);
    });
  });

  describe("totals", () => {
    it("sums the four counts across every project", () => {
      const model = inboxModel(
        inboxView({
          projects: [
            inboxProject({
              counts: inboxCounts({
                waiting: 2,
                oneWay: 1,
                reported: 1,
                closed: 0,
              }),
            }),
            inboxProject({
              counts: inboxCounts({
                waiting: 1,
                oneWay: 0,
                reported: 2,
                closed: 1,
              }),
            }),
          ],
        }),
      );
      expect(model.totals).toStrictEqual({
        waiting: 3,
        oneWay: 1,
        reported: 3,
        closed: 1,
      });
    });

    it("is all zeroes for an empty inbox", () => {
      expect(inboxModel(inboxView()).totals).toStrictEqual({
        waiting: 0,
        oneWay: 0,
        reported: 0,
        closed: 0,
      });
    });
  });
});
