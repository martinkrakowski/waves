import type { Project, StoredSnapshot } from "@hexagen-monaco/waves-contract";

import type { StorePort } from "./ports/store.js";

/**
 * The one spelling of a bearer token this service accepts: the exact scheme
 * `Bearer`, exactly one space, and a token of 32 to 128 characters of A-Z, a-z,
 * 0-9, `_` and `-`. Anything else is not a token, so it never reaches a digest.
 */
export const BEARER_PREFIX = "Bearer ";

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

const BYTE_VALUES = "0123456789abcdef";
const DIGITS_PER_BYTE = 2;

/**
 * A sha256 digest. A `Buffer` is one of these, so an adapter that hashes with
 * `node:crypto` hands its bytes straight over.
 */
export type Digest = Uint8Array;

/**
 * The comparison every authentication goes through, injected because it is the
 * one thing in this layer that needs `node:crypto`: the application layer may
 * not import it. The default is `digestsEqual` from the adapter.
 */
export type DigestComparer = (a: Digest, b: Digest) => boolean;

export function bearerToken(header: string | undefined): string | undefined {
  if (header === undefined || !header.startsWith(BEARER_PREFIX)) {
    return undefined;
  }
  const token = header.slice(BEARER_PREFIX.length);
  return TOKEN_PATTERN.test(token) ? token : undefined;
}

/**
 * Reads the stored hex digest into bytes, one byte per two characters. A digest
 * that is not the 64 characters the contract requires comes back the wrong
 * length, which the comparison below refuses as a mismatch instead of trusting.
 */
export function hexToDigest(hex: string): Digest {
  const bytes = new Uint8Array(Math.ceil(hex.length / DIGITS_PER_BYTE));
  for (let index = 0; index < bytes.length; index += 1) {
    const pair = hex.slice(
      index * DIGITS_PER_BYTE,
      (index + 1) * DIGITS_PER_BYTE,
    );
    const high = BYTE_VALUES.indexOf(pair.charAt(0));
    const low = BYTE_VALUES.indexOf(pair.charAt(1));
    bytes[index] = high < 0 || low < 0 ? 0 : high * 16 + low;
  }
  return bytes;
}

/**
 * Compares two digests and refuses to guess: `timingSafeEqual` throws on a
 * length mismatch, and a throw here means the stored digest is corrupt rather
 * than that the token is right, so it is a mismatch and nothing more. A
 * mismatch in lengths can also only come from a token of the wrong shape, which
 * `TOKEN_PATTERN` has already excluded, so the stored side is the suspect.
 */
export function matches(
  compare: DigestComparer,
  presented: Digest,
  expected: Digest,
): boolean {
  try {
    return compare(presented, expected);
  } catch {
    return false;
  }
}

export type Authentication =
  | { readonly kind: "unknown" }
  | { readonly kind: "wrong-project"; readonly id: string }
  | { readonly kind: "accepted"; readonly id: string };

export interface AuthenticatorDeps {
  readonly store: StorePort<Project, StoredSnapshot>;
  readonly compare: DigestComparer;
}

export interface Authenticator {
  /**
   * `presented` is the digest of the token the request carried, or undefined
   * when it carried none this service will accept. `expectedProject` is the
   * project the path names, or undefined where no project is named: every
   * stored digest is compared either way, so the time an answer takes says
   * nothing about which project a token belongs to.
   */
  (
    presented: Digest | undefined,
    expectedProject?: string,
  ): Promise<Authentication>;
}

export function createAuthenticator(deps: AuthenticatorDeps): Authenticator {
  const { store, compare } = deps;

  return async (presented, expectedProject) => {
    if (presented === undefined) {
      return { kind: "unknown" };
    }
    const projects = await store.listProjects();
    let matched: string | undefined;
    for (const project of projects) {
      const same = matches(
        compare,
        presented,
        hexToDigest(project.tokenSha256),
      );
      if (same && matched === undefined) {
        matched = project.id;
      }
    }
    if (matched === undefined) {
      return { kind: "unknown" };
    }
    if (expectedProject !== undefined && matched !== expectedProject) {
      return { kind: "wrong-project", id: matched };
    }
    return { kind: "accepted", id: matched };
  };
}
