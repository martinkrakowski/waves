import {
  isProjectId,
  type Project,
  type ProjectStatus,
  type StoredSnapshot,
  type ValidationIssue,
  validateProject,
} from "@hexagen-monaco/waves-contract";

import type { StorePort, StoredStatus } from "./ports/store.js";
import type { NoticeStorePort } from "./ports/notice-store.js";
import type { Now } from "./read-model.js";

/**
 * The body a project registration carries, before the two fields only this
 * service knows: the digest of its token and the moment it was registered.
 */
export const REGISTRATION_KEYS: readonly string[] = ["id", "name", "repo"];

export interface WriteModelDeps {
  readonly store: StorePort<Project, StoredSnapshot>;
  readonly noticeStore: NoticeStorePort;
  readonly now: Now;
  /** Mints a new project token. Injected: randomness is an adapter's. */
  readonly mintToken: () => string;
  /** The lowercase hex sha256 of a token. Injected, like the mint. */
  readonly digestHex: (token: string) => string;
}

export type Registration =
  | { readonly kind: "invalid"; readonly errors: readonly ValidationIssue[] }
  | { readonly kind: "conflict" }
  | { readonly kind: "ceiling" }
  | {
      readonly kind: "registered";
      readonly id: string;
      readonly token: string;
    };

/**
 * The registry size past which the enrollment token creates nothing more. It
 * counts every project, however it was registered: projects the admin token
 * registered leave less room for enrollments, not more. A constant, not
 * configuration: a leaked enrollment token can fill the registry to a size the
 * owner can see and count, and no further. It bounds how many, never what is in
 * it, and the admin token is not subject to it.
 */
export const ENROLL_CEILING = 64;

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

/** A body that is an object and carries no key the contract does not own. */
type Closed =
  | { readonly kind: "invalid"; readonly errors: readonly ValidationIssue[] }
  | { readonly kind: "closed"; readonly record: Record<string, unknown> };

/** A body the contract accepted, with the token minted for it. */
type Built =
  | { readonly kind: "invalid"; readonly errors: readonly ValidationIssue[] }
  | {
      readonly kind: "built";
      readonly project: Project;
      readonly token: string;
    };

/** The id a record names, or undefined when it names none the store could hold. */
function projectIdOf(record: Record<string, unknown>): string | undefined {
  const id = record.id;
  return typeof id === "string" && isProjectId(id) ? id : undefined;
}

export function createWriteModel(deps: WriteModelDeps) {
  const { store, noticeStore, now, mintToken, digestHex } = deps;

  function closed(body: unknown): Closed {
    const issues = closedIssues(body);
    return issues.length > 0
      ? { kind: "invalid", errors: issues }
      : { kind: "closed", record: body as Record<string, unknown> };
  }

  /**
   * The two fields only this service knows, added to a body that is already
   * known to be an object of the three registration keys, and the contract's
   * answer on the result. The token is minted here and nowhere else, and only
   * once the body is known to be one this service will answer at all.
   */
  function build(record: Record<string, unknown>, registeredAt: string): Built {
    const token = mintToken();
    const validated = validateProject({
      ...record,
      tokenSha256: digestHex(token),
      registeredAt,
    });
    if (!validated.ok) {
      return { kind: "invalid", errors: validated.errors };
    }
    return { kind: "built", project: validated.value, token };
  }

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

    /**
     * Stores a project's status document with the moment the service received
     * it, beside `putWave` and by the same rule: the clock that stamps it is the
     * server's, and it is the instant every staleness rule of a status reads —
     * never the pusher's own `generatedAt`.
     *
     * The document is already the one the contract accepted, so there is nothing
     * to decide here that `putWave` does not decide too.
     */
    async putStatus(
      project: string,
      status: ProjectStatus,
    ): Promise<StoredStatus> {
      const stored: StoredStatus = { status, receivedAt: timestampOf(now()) };
      await store.putStatus(stored);
      return stored;
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
     *
     * A registration that is not a rotation goes through the same serialized
     * create as an enrollment, with no ceiling: reading the project and then
     * writing it would let an enrollment of the same id land in between, and the
     * admin write would then overwrite a token the enrollment had just handed out.
     */
    async registerProject(
      body: unknown,
      rotate: boolean,
    ): Promise<Registration> {
      const opened = closed(body);
      if (opened.kind === "invalid") {
        return opened;
      }
      if (!rotate) {
        const fresh = build(opened.record, timestampOf(now()));
        if (fresh.kind === "invalid") {
          return fresh;
        }
        const outcome = await store.createProject(
          fresh.project,
          Number.POSITIVE_INFINITY,
        );
        return outcome === "created"
          ? { kind: "registered", id: fresh.project.id, token: fresh.token }
          : { kind: "conflict" };
      }
      // An id the contract would refuse never reaches the store, so a body with
      // a malformed id is validated rather than looked up.
      const id = projectIdOf(opened.record);
      const existing =
        id === undefined ? undefined : await store.getProject(id);
      const built = build(
        opened.record,
        existing?.registeredAt ?? timestampOf(now()),
      );
      if (built.kind === "invalid") {
        return built;
      }
      await store.putProject(built.project);
      return { kind: "registered", id: built.project.id, token: built.token };
    },

    /**
     * Registers a project that does not exist yet, and only that. Where the
     * admin path reads the project and then writes it, this one hands the whole
     * decision to one serialized store operation: the id taken and the ceiling
     * are read from the same registry the write goes to, so two enrollments of
     * one id cannot both win and two at the ceiling cannot both pass.
     */
    async enrollProject(body: unknown): Promise<Registration> {
      const opened = closed(body);
      if (opened.kind === "invalid") {
        return opened;
      }
      const built = build(opened.record, timestampOf(now()));
      if (built.kind === "invalid") {
        return built;
      }
      const outcome = await store.createProject(built.project, ENROLL_CEILING);
      if (outcome === "created") {
        return { kind: "registered", id: built.project.id, token: built.token };
      }
      return outcome === "exists" ? { kind: "conflict" } : { kind: "ceiling" };
    },

    /**
     * False when there was no such project. The store deletes silently, so the
     * caller reads first: an unknown id is a 404, not a 204. The project's
     * notices go with it (design W60): the registry's own delete takes the
     * waves and the status, and the notice store takes the decisions and events.
     */
    async deleteProject(id: string): Promise<boolean> {
      const stored = await store.getProject(id);
      if (stored === undefined) {
        return false;
      }
      await store.deleteProject(id);
      await noticeStore.deleteNotices(id);
      return true;
    },
  };
}

export type WriteModel = ReturnType<typeof createWriteModel>;
