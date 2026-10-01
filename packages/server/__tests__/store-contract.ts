import { describe, expect, it } from "vitest";

import type { Project, StoredSnapshot } from "@hexagen-monaco/waves-contract";

import type { StorePort } from "../src/index.js";

export interface StoreHarness {
  readonly store: StorePort<Project, StoredSnapshot>;
  readonly dispose: () => Promise<void>;
}

export function project(id: string, name = id): Project {
  return {
    id,
    name,
    repo: `https://example.com/${id}.git`,
    tokenSha256: "b".repeat(64),
    registeredAt: "2026-10-01T12:00:00Z",
  };
}

export function snapshot(wave: string, generatedAt?: string): StoredSnapshot {
  return {
    envelope: {
      schema: "waves/v1",
      project: "alpha",
      wave,
      generatedAt: generatedAt ?? "2026-10-01T12:00:00Z",
      intervalSeconds: 10,
      lanes: [],
    },
    receivedAt: "2026-10-01T12:00:01Z",
  };
}

export function runStoreContract(createHarness: () => StoreHarness): void {
  describe("StorePort", () => {
    it("round-trips a project", async () => {
      const { store, dispose } = createHarness();
      try {
        const alpha = project("alpha", "Alpha");
        await store.putProject(alpha);

        await expect(store.getProject("alpha")).resolves.toEqual(alpha);
        await expect(store.listProjects()).resolves.toEqual([alpha]);
      } finally {
        await dispose();
      }
    });

    it("returns undefined for an unknown project", async () => {
      const { store, dispose } = createHarness();
      try {
        await expect(store.getProject("absent")).resolves.toBeUndefined();
        await expect(store.listProjects()).resolves.toEqual([]);
      } finally {
        await dispose();
      }
    });

    it("replaces a project stored under the same id", async () => {
      const { store, dispose } = createHarness();
      try {
        await store.putProject(project("alpha", "First"));
        await store.putProject(project("alpha", "Second"));

        await expect(store.getProject("alpha")).resolves.toEqual(
          project("alpha", "Second"),
        );
        await expect(store.listProjects()).resolves.toHaveLength(1);
      } finally {
        await dispose();
      }
    });

    it("lists projects ordered by id", async () => {
      const { store, dispose } = createHarness();
      try {
        await store.putProject(project("gamma"));
        await store.putProject(project("alpha"));
        await store.putProject(project("beta"));

        await expect(store.listProjects()).resolves.toEqual([
          project("alpha"),
          project("beta"),
          project("gamma"),
        ]);
      } finally {
        await dispose();
      }
    });

    it("round-trips a snapshot", async () => {
      const { store, dispose } = createHarness();
      try {
        await store.putSnapshot(snapshot("wv1"));

        await expect(store.getSnapshot("alpha", "wv1")).resolves.toEqual(
          snapshot("wv1"),
        );
        await expect(store.listSnapshots("alpha")).resolves.toEqual([
          snapshot("wv1"),
        ]);
      } finally {
        await dispose();
      }
    });

    it("replaces a snapshot stored under the same wave", async () => {
      const { store, dispose } = createHarness();
      try {
        await store.putSnapshot(snapshot("wv1", "2026-10-01T12:00:00Z"));
        await store.putSnapshot(snapshot("wv1", "2026-10-01T13:00:00Z"));

        await expect(store.getSnapshot("alpha", "wv1")).resolves.toEqual(
          snapshot("wv1", "2026-10-01T13:00:00Z"),
        );
        await expect(store.listSnapshots("alpha")).resolves.toHaveLength(1);
      } finally {
        await dispose();
      }
    });

    it("returns undefined for an unknown snapshot", async () => {
      const { store, dispose } = createHarness();
      try {
        await expect(
          store.getSnapshot("absent", "wv1"),
        ).resolves.toBeUndefined();
        await expect(
          store.getSnapshot("alpha", "wv1"),
        ).resolves.toBeUndefined();
        await expect(store.listSnapshots("absent")).resolves.toEqual([]);

        await store.putSnapshot(snapshot("wv1"));
        await expect(
          store.getSnapshot("alpha", "wv2"),
        ).resolves.toBeUndefined();
      } finally {
        await dispose();
      }
    });

    it("lists the waves of a project ordered by wave id", async () => {
      const { store, dispose } = createHarness();
      try {
        await store.putSnapshot(snapshot("wv3"));
        await store.putSnapshot(snapshot("wv1"));
        await store.putSnapshot(snapshot("wv2"));

        await expect(store.listSnapshots("alpha")).resolves.toEqual([
          snapshot("wv1"),
          snapshot("wv2"),
          snapshot("wv3"),
        ]);
      } finally {
        await dispose();
      }
    });

    it("deletes a single snapshot and keeps the others", async () => {
      const { store, dispose } = createHarness();
      try {
        await store.putSnapshot(snapshot("wv1"));
        await store.putSnapshot(snapshot("wv2"));

        await store.deleteSnapshot("alpha", "wv1");

        await expect(store.listSnapshots("alpha")).resolves.toEqual([
          snapshot("wv2"),
        ]);
      } finally {
        await dispose();
      }
    });

    it("ignores the deletion of an unknown snapshot", async () => {
      const { store, dispose } = createHarness();
      try {
        await store.putSnapshot(snapshot("wv1"));

        await store.deleteSnapshot("alpha", "absent");
        await store.deleteSnapshot("absent", "wv1");

        await expect(store.listSnapshots("alpha")).resolves.toEqual([
          snapshot("wv1"),
        ]);
      } finally {
        await dispose();
      }
    });

    it("deletes a project together with its snapshots", async () => {
      const { store, dispose } = createHarness();
      try {
        await store.putProject(project("alpha"));
        await store.putSnapshot(snapshot("wv1"));
        await store.putSnapshot(snapshot("wv2"));

        await store.deleteProject("alpha");

        await expect(store.getProject("alpha")).resolves.toBeUndefined();
        await expect(store.listProjects()).resolves.toEqual([]);
        await expect(store.listSnapshots("alpha")).resolves.toEqual([]);
        await expect(
          store.getSnapshot("alpha", "wv1"),
        ).resolves.toBeUndefined();
      } finally {
        await dispose();
      }
    });

    it("ignores the deletion of an unknown project", async () => {
      const { store, dispose } = createHarness();
      try {
        await store.putProject(project("alpha"));
        await store.putSnapshot(snapshot("wv1"));

        await store.deleteProject("absent");

        await expect(store.listProjects()).resolves.toEqual([project("alpha")]);
        await expect(store.listSnapshots("alpha")).resolves.toEqual([
          snapshot("wv1"),
        ]);
      } finally {
        await dispose();
      }
    });
  });
}
