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

export function withLanes(wave: string, count: number): StoredSnapshot {
  const base = snapshot(wave);
  return {
    envelope: {
      ...base.envelope,
      lanes: Array.from({ length: count }, (_unused, index) => ({
        id: `${wave}-${index}`,
        derived: { alive: true },
        disagreements: [],
      })),
    },
    receivedAt: base.receivedAt,
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

    it("lists the heads of a project without its full snapshots", async () => {
      const { store, dispose } = createHarness();
      try {
        await store.putSnapshot(snapshot("wv2"));
        await store.putSnapshot(withLanes("wv1", 2));

        await expect(store.listSnapshotHeads("alpha")).resolves.toEqual([
          {
            wave: "wv1",
            receivedAt: "2026-10-01T12:00:01Z",
            intervalSeconds: 10,
            lanes: 2,
          },
          {
            wave: "wv2",
            receivedAt: "2026-10-01T12:00:01Z",
            intervalSeconds: 10,
            lanes: 0,
          },
        ]);
        await expect(store.listSnapshotHeads("absent")).resolves.toEqual([]);
      } finally {
        await dispose();
      }
    });

    it("keeps the heads in step with the snapshots of a project", async () => {
      const { store, dispose } = createHarness();
      try {
        await store.putSnapshot(snapshot("wv1"));
        await store.putSnapshot(snapshot("wv2"));
        await store.deleteSnapshot("alpha", "wv1");
        await store.deleteSnapshot("alpha", "absent");
        await expect(store.listSnapshotHeads("alpha")).resolves.toEqual([
          {
            wave: "wv2",
            receivedAt: "2026-10-01T12:00:01Z",
            intervalSeconds: 10,
            lanes: 0,
          },
        ]);

        await store.deleteProject("alpha");
        await expect(store.listSnapshotHeads("alpha")).resolves.toEqual([]);
        await expect(store.listSnapshotHeads("absent")).resolves.toEqual([]);
      } finally {
        await dispose();
      }
    });

    it("replaces the head of a wave stored again", async () => {
      const { store, dispose } = createHarness();
      try {
        await store.putSnapshot(snapshot("wv1"));
        await store.putSnapshot({
          ...snapshot("wv1"),
          receivedAt: "2026-10-01T13:00:01Z",
        });

        await expect(store.listSnapshotHeads("alpha")).resolves.toEqual([
          {
            wave: "wv1",
            receivedAt: "2026-10-01T13:00:01Z",
            intervalSeconds: 10,
            lanes: 0,
          },
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

    it("returns undefined for an id that names an inherited property", async () => {
      const { store, dispose } = createHarness();
      try {
        await expect(store.getProject("constructor")).resolves.toBeUndefined();
        await expect(
          store.getSnapshot("constructor", "wv1"),
        ).resolves.toBeUndefined();
        await expect(store.listProjects()).resolves.toEqual([]);
      } finally {
        await dispose();
      }
    });

    it.each(["../escape", "a/b", "..", "ALPHA", "", "a".repeat(64)])(
      "rejects the invalid project id %j",
      async (id) => {
        const { store, dispose } = createHarness();
        try {
          await expect(store.getProject(id)).rejects.toThrow(
            "invalid project id",
          );
          await expect(store.deleteProject(id)).rejects.toThrow(
            "invalid project id",
          );
          await expect(store.listSnapshots(id)).rejects.toThrow(
            "invalid project id",
          );
          await expect(store.listSnapshotHeads(id)).rejects.toThrow(
            "invalid project id",
          );
          await expect(store.putProject(project(id))).rejects.toThrow(
            "invalid project id",
          );
          await expect(store.getSnapshot(id, "wv1")).rejects.toThrow(
            "invalid project id",
          );
          await expect(store.deleteSnapshot(id, "wv1")).rejects.toThrow(
            "invalid project id",
          );
          await expect(
            store.putSnapshot({
              envelope: { ...snapshot("wv1").envelope, project: id },
              receivedAt: "2026-10-01T12:00:01Z",
            }),
          ).rejects.toThrow("invalid project id");
        } finally {
          await dispose();
        }
      },
    );

    it.each(["wv/1", "..", "wv.1", "-wv", "", "w".repeat(81)])(
      "rejects the invalid wave id %j",
      async (wave) => {
        const { store, dispose } = createHarness();
        try {
          await expect(store.getSnapshot("alpha", wave)).rejects.toThrow(
            "invalid wave id",
          );
          await expect(store.deleteSnapshot("alpha", wave)).rejects.toThrow(
            "invalid wave id",
          );
          await expect(
            store.putSnapshot({
              envelope: { ...snapshot("wv1").envelope, wave },
              receivedAt: "2026-10-01T12:00:01Z",
            }),
          ).rejects.toThrow("invalid wave id");
        } finally {
          await dispose();
        }
      },
    );

    it("keeps every project of twenty concurrent writes", async () => {
      const { store, dispose } = createHarness();
      try {
        const ids = Array.from({ length: 20 }, (_unused, index) => `p${index}`);

        const writes = ids.map((id) => store.putProject(project(id)));

        await expect(Promise.all(writes)).resolves.toHaveLength(20);
        await expect(store.listProjects()).resolves.toEqual(
          [...ids].sort().map((id) => project(id)),
        );
      } finally {
        await dispose();
      }
    });

    it("serialises a snapshot and a deletion of the same project", async () => {
      const { store, dispose } = createHarness();
      try {
        await store.putProject(project("alpha"));
        await store.putSnapshot(snapshot("wv1"));

        const interleaved = await Promise.all([
          store.putSnapshot(snapshot("wv2")),
          store.deleteProject("alpha"),
          store.putSnapshot(snapshot("wv3")),
        ]);

        expect(interleaved).toHaveLength(3);
        await expect(store.getProject("alpha")).resolves.toBeUndefined();
        await expect(store.listProjects()).resolves.toEqual([]);
        await expect(store.listSnapshots("alpha")).resolves.toEqual([
          snapshot("wv3"),
        ]);
      } finally {
        await dispose();
      }
    });
  });
}
