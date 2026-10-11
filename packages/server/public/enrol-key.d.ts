/**
 * The `/enrol-key` page's pure helpers, factored out so the DOM bits can be
 * tested against them. Nothing in this module reads the network or the clock;
 * the page's logic takes the browser objects it needs as parameters.
 */

/**
 * Convert a DER-encoded ECDSA-P-256 signature to the raw 64-byte `r‖s` form
 * WebCrypto's `subtle.verify` takes, throwing an `Error` for anything that is
 * not a minimal, well-formed DER SEQUENCE of two P-256 integers.
 *
 * @param der - A DER-encoded ECDSA-P-256 signature.
 * @returns A 64-byte buffer: `r` zero-padded to 32 bytes followed by `s`
 *   zero-padded to 32 bytes.
 */
export declare function derToRawP256(der: ArrayBuffer | Uint8Array): Uint8Array;
