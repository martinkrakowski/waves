/**
 * Where a nonce's bytes come from. In production it is 32 random bytes as
 * base64url; in a test it is a counter, so a test never depends on the bytes
 * or the length of a random value. Randomness is an adapter's concern, so the
 * application layer holds only this type and asks for the string.
 */
export type NonceSource = () => string;
