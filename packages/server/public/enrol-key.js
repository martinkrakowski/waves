/**
 * The `/enrol-key` page: a passkey made on this device, answered from the browser.
 *
 * This page runs entirely in the browser. It sends nothing to the server — no
 * `fetch`, no form, no storage. Everything it shows is computed from what the
 * device returns, and the only things the module is handed are the browser
 * objects it reads from, so a test can pass fakes for all of them.
 */

/**
 * Convert an ECDSA P-256 signature from DER to the raw 64-byte `r‖s` form that
 * WebCrypto's `subtle.verify` takes. A DER signature is a SEQUENCE of two
 * INTEGERs, `r` then `s`; each INTEGER may carry a single leading `0x00` sign
 * byte, which is stripped, and each is left-padded with zeros to 32 bytes.
 *
 * Anything that is not a minimal, well-formed DER SEQUENCE of two P-256
 * integers is refused with a thrown `Error`: a bad tag, a truncated length, an
 * empty, negative or over-long integer, non-minimal padding, or trailing
 * bytes. The failure is meant to surface as one failed check on the page, not
 * as a crash.
 *
 * @param {ArrayBuffer | Uint8Array} der A DER-encoded ECDSA-P-256 signature.
 * @returns {Uint8Array} A 64-byte buffer, `r` zero-padded to 32 bytes followed
 *   by `s` zero-padded to 32 bytes.
 */
export function derToRawP256(der) {
  const bytes =
    der instanceof Uint8Array
      ? new Uint8Array(der.buffer, der.byteOffset, der.byteLength)
      : new Uint8Array(der);
  let at = 0;
  const read = () => {
    if (at >= bytes.length) {
      throw new Error("unexpected end of signature");
    }
    return bytes[at++];
  };
  const length = () => {
    const head = read();
    if (head < 0x80) {
      return head;
    }
    if (head === 0x80) {
      throw new Error("indefinite length is not allowed");
    }
    const count = head & 0x7f;
    if (count > 4) {
      throw new Error("length is out of range");
    }
    if (at + count > bytes.length) {
      throw new Error("length exceeds the signature");
    }
    let total = 0;
    for (let i = 0; i < count; i++) {
      total = (total << 8) | read();
    }
    return total;
  };
  const integer = () => {
    if (read() !== 0x02) {
      throw new Error("expected an INTEGER");
    }
    const len = length();
    if (len === 0 || at + len > bytes.length) {
      throw new Error("INTEGER is out of range");
    }
    const start = at;
    at += len;
    const first = bytes[start];
    let valueStart = start;
    if (first === 0x00) {
      // A leading zero is valid only as a sign byte: it must be followed by a
      // byte whose high bit is set. Anything else is non-minimal DER.
      if (len > 1 && (bytes[start + 1] & 0x80) !== 0) {
        valueStart = start + 1;
      } else if (len > 1) {
        throw new Error("INTEGER has a non-minimal leading zero");
      }
    } else if (first & 0x80) {
      throw new Error("INTEGER is negative");
    }
    const value = bytes.subarray(valueStart, start + len);
    if (value.length > 32) {
      throw new Error("INTEGER is too large for P-256");
    }
    return value;
  };
  if (read() !== 0x30) {
    throw new Error("expected a SEQUENCE");
  }
  const len = length();
  const end = at + len;
  if (end > bytes.length) {
    throw new Error("SEQUENCE exceeds the signature");
  }
  const r = integer();
  const s = integer();
  if (at !== end) {
    throw new Error("trailing bytes in the signature");
  }
  if (at !== bytes.length) {
    throw new Error("trailing bytes after the signature");
  }
  const raw = new Uint8Array(64);
  raw.set(r, 32 - r.length);
  raw.set(s, 32 - s.length + 32);
  return raw;
}
