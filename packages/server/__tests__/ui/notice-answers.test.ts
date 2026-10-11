import { describe, expect, it } from "vitest";

import { drawableInbox } from "../../public/inbox.js";
import { drawableDecision } from "../../public/decision.js";
import { drawableProjectInbox } from "../../public/project-inbox.js";
import { drawableProjectEvents } from "../../public/project-events.js";
import {
  createNoticeReadModel,
  MAX_NOTICE_EVENTS,
} from "../../src/application/notice-read-model.js";
import { MemoryStore } from "../../src/infrastructure/memory-store.js";

import { event, signedEntry, storedRevision } from "../notice-contract.js";
import type { StoredEvent } from "../../src/application/ports/notice-store.js";

const PROJECT = "alpha";
const NAME = "Alpha";
const ID = "d1";
/** Two hours after the revision's raisedAt: well within the 14-day inbox window. */
const NOW_MS = Date.parse("2026-10-08T14:00:00.000Z");

/**
 * One project, registered at midnight, and one decision revision raised two
 * hours before the fixed clock. The read model built from these is the same one
 * the HTTP routes hand their answers to, so the bodies below are the real
 * shapes the routes in `http-server.ts` serve — not a hand-written fixture that
 * could drift past them.
 */
async function seeded() {
  const store = new MemoryStore();
  await store.putProject({
    id: PROJECT,
    name: NAME,
    tokenSha256: "0".repeat(64),
    registeredAt: "2026-10-01T00:00:00Z",
  });
  await store.appendRevision(
    PROJECT,
    ID,
    storedRevision(1, ID, PROJECT),
    0,
    10,
  );
  const model = createNoticeReadModel({
    store,
    noticeStore: store,
    now: () => NOW_MS,
  });
  return { store, model };
}

/**
 * Guards against the three shape checks and the three read-model answers they
 * are given drifting apart. Each test builds the body the HTTP route hands to
 * the check — `http-server.ts` turns `inbox()` into `{ projects: … }`,
 * `decisionsView` into `{ project, counts, decisions }` and `getDecision` into
 * the view itself — and asserts the check accepts it. If a check refuses a real
 * answer, the check — not the test — is the second defect.
 */
describe("the three notice shapes the HTTP routes serve", () => {
  it("drawableInbox accepts the inbox route's body", async () => {
    const { model } = await seeded();
    const body = { projects: await model.inbox() };
    expect(drawableInbox(body)).toBe(true);
  });

  it("drawableProjectInbox accepts the decisions route's body", async () => {
    const { model } = await seeded();
    const view = await model.decisionsView(PROJECT);
    const body = {
      project: PROJECT,
      counts: view.counts,
      decisions: view.decisions,
    };
    expect(drawableProjectInbox(body, PROJECT)).toBe(true);
  });

  it("drawableDecision accepts the decision route's body", async () => {
    const { model } = await seeded();
    const body = await model.getDecision(PROJECT, ID);
    expect(body).toBeDefined();
    expect(drawableDecision(body, PROJECT, ID)).toBe(true);
  });

  it("drawableProjectEvents accepts the events route's body", async () => {
    const { store, model } = await seeded();
    const stored: StoredEvent = {
      id: "",
      receivedAt: "2026-10-08T13:00:00.000Z",
      event: event(),
    };
    await store.appendEvent(PROJECT, stored, MAX_NOTICE_EVENTS);
    const body = { events: await model.events(PROJECT, MAX_NOTICE_EVENTS) };
    expect(drawableProjectEvents(body, PROJECT)).toBe(true);
  });

  it("the inbox and project inbox accept a signed answer the store holds", async () => {
    const { store, model } = await seeded();
    const outcome = await store.appendEntry(PROJECT, ID, signedEntry(0), 0, 1);
    expect(outcome).toBe("stored");

    const head = (await model.inbox())[0]!.decisions[0]!;
    expect(head.group).toBe("reported");
    expect(head.state).toBe("approved");
    expect(head.source).toBe("signed");

    expect(drawableInbox({ projects: await model.inbox() })).toBe(true);
    const view = await model.decisionsView(PROJECT);
    expect(
      drawableProjectInbox(
        { project: PROJECT, counts: view.counts, decisions: view.decisions },
        PROJECT,
      ),
    ).toBe(true);
  });
});
