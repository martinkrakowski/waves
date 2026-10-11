import type { Project } from "@hexagen-monaco/waves-contract";

/**
 * The two stored fields that tell one registration of an id from the next. A
 * re-registration mints a new token and a new date, so both fields change; a
 * rotation keeps the date and changes only the digest, so a rotated-away token
 * stops writing too — one field alone is never enough to tell them apart.
 */
export interface RegistrationIdentity {
  readonly tokenSha256: string;
  readonly registeredAt: string;
}

/** The registration of a project as it was read: only the two fields above. */
export function registrationOf(
  project: Project,
): RegistrationIdentity {
  return {
    tokenSha256: project.tokenSha256,
    registeredAt: project.registeredAt,
  };
}

/** True only when `current` exists and is the registration that authenticated. */
export function sameRegistration(
  current: Project | undefined,
  authenticated: RegistrationIdentity,
): boolean {
  return (
    current !== undefined &&
    current.tokenSha256 === authenticated.tokenSha256 &&
    current.registeredAt === authenticated.registeredAt
  );
}

export interface RegistrationGate {
  /**
   * Runs `operation` after every operation handed in before it has settled, and
   * never beside another.
   */
  exclusive<T>(operation: () => Promise<T>): Promise<T>;
}

/**
 * Issue #62: a project-token write was authenticated, then its body was read,
 * then it was stored — and between the authentication and the store call a
 * delete and a re-registration under the same id could commit, so the old
 * request was stored under the NEW registration. This gate makes "re-read the
 * project, compare registrations, write" and every registry change (register,
 * rotate, enroll, delete) mutually exclusive: nothing can commit between the
 * compare and the write.
 *
 * One process owns the data directory — the service runs as a single replica —
 * so a gate inside that one process is the whole story; there is no second
 * process whose registry change could slip past it.
 *
 * An operation that never settles holds every later write, exactly as the
 * stores' own serialization queues already do for a store call that never
 * returns.
 */
export function createRegistrationGate(): RegistrationGate {
  let queue: Promise<void> = Promise.resolve();
  const ignore = (): undefined => undefined;
  return {
    exclusive(operation) {
      const run = queue.then(operation);
      queue = run.then(ignore, ignore);
      return run;
    },
  };
}
