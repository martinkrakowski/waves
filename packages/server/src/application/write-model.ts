import {
  isProjectId,
  type Project,
  type StoredSnapshot,
  type ValidationIssue,
  validateProject,
} from "@hexagen-monaco/waves-contract";

import type { StorePort } from "./ports/store.js";
import type { Now } from "./read-model.js";

/**
 * The body a project registration carries, before the two fields only this
 * service knows: the digest of its token and the moment it was registered.
 */
export const REGISTRATION_KEYS: readonly string[] = ["id", "name", "repo"];

export interface WriteModelDeps {
  readonly store: StorePort<Project, StoredSnapshot>;
  readonly now: Now;
  /** Mints a new project token. Injected: randomness is an adapter's. */
  readonly mintToken: () => string;
  /** The lowercase hex sha256 of a token. Injected, like the mint. */
  readonly digestHex: (token: string) => string;
}

export type Registration =
  | { readonly kind: "invalid"; readonly errors: readonly ValidationIssue[] }
  | { readonly kind: "conflict" }
  | {
      readonly kind: "registered";
      readonly id: string;
      readonly token: string;
    };

function escapeKey(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The registration body is closed: only these three keys, so a client cannot
 * smuggle `tokenSha256` or `registeredAt` in and choose its own digest or its
 * own age.
 */
function closedIssues(body: unknown): readonly ValidationIssue[] {
  if (!isRecord(body)) {
    return [{ path: "", message: "expected an object" }];
  }
  const issues: ValidationIssue[] = [];
  for (const key of Object.keys(body)) {
    if (!REGISTRATION_KEYS.includes(key)) {
      issues.push({ path: `/${escapeKey(key)}`, message: "unknown key" });
    }
  }
  return issues;
}

function timestampOf(atMs: number): string {
  return new Date(atMs).toISOString();
}

export function createWriteModel(deps: WriteModelDeps) {
  const { store, now, mintToken, digestHex } = deps;

  return {
    /** Stores a snapshot with the moment the service received it. */
    async putWave(
      project: string,
      envelope: StoredSnapshot["envelope"],
    ): Promise<StoredSnapshot> {
      const snapshot: StoredSnapshot = {
        envelope,
        receivedAt: timestampOf(now()),
      };
      await store.putSnapshot(snapshot);
      return snapshot;
    },

    /** False when there was no such wave, so the caller can answer 404. */
    async deleteWave(project: string, wave: string): Promise<boolean> {
      const stored = await store.getSnapshot(project, wave);
      await store.deleteSnapshot(project, wave);
      return stored !== undefined;
    },

    /**
     * Registers a project, or re-mints the token of one that exists. The token
     * is returned here and nowhere else: only its digest is kept, so the only
     * time the clear text leaves this process is in the 201 that mints it, and
     * a rotation keeps the registration date so the project's age does not
     * restart because a token leaked.
     */
    async registerProject(
      body: unknown,
      rotate: boolean,
    ): Promise<Registration> {
      const issues = closedIssues(body);
      if (issues.length > 0) {
        return { kind: "invalid", errors: issues };
      }
      const record = body as Record<string, unknown>;
      const id = record.id;
      // An id the contract would refuse never reaches the store, so a body with
      // a malformed id is validated rather than looked up.
      const existing =
        typeof id === "string" && isProjectId(id)
          ? await store.getProject(id)
          : undefined;
      const token = mintToken();
      const built = {
        ...record,
        tokenSha256: digestHex(token),
        registeredAt: existing?.registeredAt ?? timestampOf(now()),
      };
      const validated = validateProject(built);
      if (!validated.ok) {
        return { kind: "invalid", errors: validated.errors };
      }
      if (existing !== undefined && !rotate) {
        return { kind: "conflict" };
      }
      await store.putProject(validated.value);
      return { kind: "registered", id: validated.value.id, token };
    },

    /**
     * False when there was no such project. The store deletes silently, so the
     * caller reads first: an unknown id is a 404, not a 204.
     */
    async deleteProject(id: string): Promise<boolean> {
      const stored = await store.getProject(id);
      if (stored === undefined) {
        return false;
      }
      await store.deleteProject(id);
      return true;
    },
  };
}

export type WriteModel = ReturnType<typeof createWriteModel>;
