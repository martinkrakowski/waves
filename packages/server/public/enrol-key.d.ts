/**
 * The `/enrol-key` page's logic, factored out from its view so the logic can be
 * tested with fakes for `credentials`, `crypto` and `location`. Nothing in this
 * module reads the network or the clock: a challenge and a user id come from
 * `crypto.getRandomValues`, and the current time is taken only to stamp the
 * JSON line.
 */

/** The flags an authenticator data byte carries, read by their bit. */
export interface EnrolFlags {
  readonly userVerified: boolean;
  readonly backupEligible: boolean;
  readonly backedUp: boolean;
}

export interface EnrolIntro {
  readonly kind: "intro";
  readonly origin: string;
  readonly rpId: string;
  readonly publicKeyCredential: boolean;
}

export interface EnrolReady {
  readonly kind: "ready";
  readonly credentialId: string;
  readonly publicKeySpki: string;
  readonly algorithm: number;
  readonly transports: string;
  readonly userVerified: boolean;
  readonly backupEligible: boolean;
  readonly backedUp: boolean;
  readonly json: string;
  readonly addedAt: string;
}

export interface EnrolRefused {
  readonly kind: "refused";
  readonly reason: string;
}

export interface EnrolCreateError {
  readonly kind: "createError";
  readonly name: string;
  readonly message: string;
}

export interface EnrolCheck {
  readonly label: string;
  readonly ok: boolean;
  readonly detail?: string;
}

export interface EnrolVerified {
  readonly kind: "verified";
  readonly checks: readonly EnrolCheck[];
  readonly userVerified: boolean;
  readonly backupEligible: boolean;
  readonly backedUp: boolean;
}

export type EnrolState =
  EnrolIntro | EnrolReady | EnrolRefused | EnrolCreateError | EnrolVerified;

/**
 * The browser objects the logic reads from, faked in tests. The results are
 * `unknown` on purpose: the module reads the attestation and the assertion
 * duck-typed, so `navigator.credentials` and a hand-built fake both fit.
 */
export interface EnrolCredentials {
  create(options: PublicKeyCredentialCreationOptions): Promise<unknown>;
  get(options: PublicKeyCredentialRequestOptions): Promise<unknown>;
}

export interface EnrolLocation {
  readonly origin: string;
  readonly hostname: string;
}

export interface EnrolController {
  intro(): EnrolIntro;
  create(): Promise<EnrolReady | EnrolRefused | EnrolCreateError>;
  test(): Promise<EnrolVerified>;
}

/** Build a fresh controller bound to the given browser objects. */
export declare function enrolKey(
  credentials: EnrolCredentials,
  crypto: Crypto,
  location: EnrolLocation,
): EnrolController;

/** The WebCrypto id for ES256 (P-256 with SHA-256). */
export declare const ES256: -7;

/** A buffer of `n` bytes from `crypto.getRandomValues`. */
export declare function randomBytes(crypto: Crypto, n: number): Uint8Array;

/** Standard base64, with padding, of a buffer of bytes. */
export declare function base64(bytes: ArrayBuffer | Uint8Array): string;

/** Standard base64url, without padding, of a buffer of bytes. */
export declare function base64url(bytes: ArrayBuffer | Uint8Array): string;

/** The options this page hands to `credentials.create`. */
export declare function createOptions(
  rpId: string,
  challenge: ArrayBufferView,
  userId: ArrayBufferView,
): PublicKeyCredentialCreationOptions;

/** The options this page hands to `credentials.get` for the test signature. */
export declare function getOptions(
  rpId: string,
  challenge: ArrayBufferView,
  credentialId: ArrayBufferView,
): PublicKeyCredentialRequestOptions;

/** @returns the meaning of an authenticator data flags byte. */
export declare function flagsOf(byte: number): EnrolFlags;

/** Convert a DER-encoded ECDSA-P-256 signature to raw `r‖s` (64 bytes). */
export declare function derToRawP256(der: ArrayBuffer | Uint8Array): Uint8Array;
