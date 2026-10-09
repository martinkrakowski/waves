import { existsSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createWriteModel } from "../src/application/write-model.js";
import { createNoticeWriteModel } from "../src/application/notice-write-model.js";
import { FileNoticeStore } from "../src/infrastructure/file-notice-store.js";
import { MemoryStore } from "../src/infrastructure/memory-store.js";
import { sha256Hex } from "../src/infrastructure/sha256.js";
import { decisionRevision, event, storedRevision } from "./notice-contract.js";

const PROJECT = "alpha";
const NOW_MS = Date.parse("2026-10-08T12:00:00Z");

const registration = {
  id: PROJECT,
  name: "Alpha",
  repo: "https://example.com/alpha.git",
};

function models(noticeStore: FileNoticeStore) {
  const store = new MemoryStore();
  const mintToken = () => "minted-token-0123456789abcdefghijklmnop";
  const wave = createWriteModel({
    store,
    noticeStore,
    now: () => NOW_MS,
    mintToken,
    digestHex: sha256Hex,
  });
  const notice = createNoticeWriteModel({
    noticeStore,
    now: () => NOW_MS,
    hashText: sha256Hex,
  });
  return { wave, notice };
}

describe("registering a project clears its leftover notices", () => {
  it("register, raise, delete, register again leaves no decisions or events", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "waves-wm-"));
    try {
      const noticeStore = new FileNoticeStore(dataDir);
      const { wave, notice } = models(noticeStore);

      expect((await wave.registerProject(registration, false)).kind).toBe(
        "registered",
      );
      await notice.raiseDecision(
        PROJECT,
        "d1",
        decisionRevision("d1", PROJECT),
      );
      await notice.postEvent(PROJECT, event());
      expect(await noticeStore.listDecisions(PROJECT)).toHaveLength(1);
      expect(await noticeStore.listEvents(PROJECT, 10)).toHaveLength(1);

      const deleted = await wave.deleteProject(PROJECT);
      expect(deleted).toBe(true);
      expect(await noticeStore.listDecisions(PROJECT)).toEqual([]);
      expect(await noticeStore.listEvents(PROJECT, 10)).toEqual([]);

      // A notice write authenticated before the delete lands after it.
      await notice.raiseDecision(
        PROJECT,
        "leftover",
        decisionRevision("leftover", PROJECT),
      );
      await notice.postEvent(PROJECT, event());

      // Registering the id again wipes the leftovers before returning.
      expect((await wave.registerProject(registration, false)).kind).toBe(
        "registered",
      );
      expect(await noticeStore.listDecisions(PROJECT)).toEqual([]);
      expect(await noticeStore.listEvents(PROJECT, 10)).toEqual([]);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("removes a decisions/<project>/ directory planted before registration", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "waves-wm-"));
    try {
      const noticeStore = new FileNoticeStore(dataDir);
      const { wave } = models(noticeStore);

      // A leftover decision directory, as a stale write from a deleted project
      // would leave behind for an id that is registered again.
      await noticeStore.appendRevision(PROJECT, "d1", storedRevision(1), 0, 3);
      expect(await noticeStore.listDecisions(PROJECT)).toHaveLength(1);

      await wave.registerProject(registration, false);

      expect(await noticeStore.listDecisions(PROJECT)).toEqual([]);
      expect(existsSync(join(dataDir, "decisions", PROJECT))).toBe(false);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
