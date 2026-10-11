/**
 * The `/enrol-key` page: a passkey made on this device, answered from the
 * browser.
 *
 * This page runs entirely in the browser. It sends nothing to the server — no
 * `fetch`, no form, no storage. Everything it shows is computed from what the
 * device returns, and the logic below takes the browser objects it reads from
 * as parameters, so a test can pass fakes for every one of them.
 *
 * The shape of the work:
 *  - `intro()` tells the view what to show before any press.
 *  - `create()` builds a WebAuthn creation, calls `credentials.create`, and
 *    returns the result to draw.
 *  - `test()` builds a WebAuthn get, calls `credentials.get`, and returns the
 *    checks of the assertion to draw.
 */

const BASE64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64URL =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** A 32-byte challenge and a 16-byte user id, each from `crypto.getRandomValues`. */
const CHALLENGE_LENGTH = 32;
const USER_ID_LENGTH = 16;
/** WebCrypto's id for ES256, the one kind of passkey this page makes. */
export const ES256 = -7;
/** The relying party this page enrols a key for. */
const RP_NAME = "waves";
/** A second, in milliseconds: the ceiling the spec asks the authenticator to use. */
const TIMEOUT_MS = 120_000;

const FLAG_USER_VERIFIED = 0x04;
const FLAG_BACKUP_ELIGIBLE = 0x08;
const FLAG_BACKED_UP = 0x10;

function bytesToUint8(input) {
  return new Uint8Array(input);
}

function asciiBytes(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    out[i] = text.charCodeAt(i);
  }
  return out;
}

function bytesToString(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function bytesEqual(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}

function concat(left, right) {
  const out = new Uint8Array(left.length + right.length);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
}

/** Standard base64, with padding, of a buffer of bytes. */
export function base64(bytes) {
  const b = bytesToUint8(bytes);
  let out = "";
  let i = 0;
  for (; i + 2 < b.length; i += 3) {
    const n = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
    out +=
      BASE64[(n >> 18) & 63] +
      BASE64[(n >> 12) & 63] +
      BASE64[(n >> 6) & 63] +
      BASE64[n & 63];
  }
  const rem = b.length - i;
  if (rem === 1) {
    const n = b[i] << 16;
    out += BASE64[(n >> 18) & 63] + BASE64[(n >> 12) & 63] + "==";
  } else if (rem === 2) {
    const n = (b[i] << 16) | (b[i + 1] << 8);
    out +=
      BASE64[(n >> 18) & 63] +
      BASE64[(n >> 12) & 63] +
      BASE64[(n >> 6) & 63] +
      "=";
  }
  return out;
}

/** Standard base64url, without padding, of a buffer of bytes. */
export function base64url(bytes) {
  const b = bytesToUint8(bytes);
  let out = "";
  let i = 0;
  for (; i + 2 < b.length; i += 3) {
    const n = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
    out +=
      BASE64URL[(n >> 18) & 63] +
      BASE64URL[(n >> 12) & 63] +
      BASE64URL[(n >> 6) & 63] +
      BASE64URL[n & 63];
  }
  const rem = b.length - i;
  if (rem === 1) {
    const n = b[i] << 16;
    out += BASE64URL[(n >> 18) & 63] + BASE64URL[(n >> 12) & 63];
  } else if (rem === 2) {
    const n = (b[i] << 16) | (b[i + 1] << 8);
    out +=
      BASE64URL[(n >> 18) & 63] +
      BASE64URL[(n >> 12) & 63] +
      BASE64URL[(n >> 6) & 63];
  }
  return out;
}

/** A buffer of `n` bytes from `crypto.getRandomValues`, for challenges and ids. */
export function randomBytes(crypto, n) {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** @returns the meaning of an authenticator data flags byte. */
export function flagsOf(byte) {
  const b = byte & 0xff;
  return {
    userVerified: (b & FLAG_USER_VERIFIED) !== 0,
    backupEligible: (b & FLAG_BACKUP_ELIGIBLE) !== 0,
    backedUp: (b & FLAG_BACKED_UP) !== 0,
  };
}

/** @returns the ISO time, to the second, for the JSON line. */
function nowIsoSeconds() {
  const iso = new Date().toISOString();
  return `${iso.slice(0, 19)}Z`;
}

/**
 * The options this page hands to `credentials.create`. `attachment` says
 * where the key may be made — exactly `"platform"` (this device) or
 * `"cross-platform"` (a hardware security key); anything else is refused.
 */
export function createOptions(rpId, challenge, userId, attachment) {
  if (attachment !== "platform" && attachment !== "cross-platform") {
    throw new Error("the attachment must be 'platform' or 'cross-platform'");
  }
  return {
    rp: { id: rpId, name: RP_NAME },
    user: { id: userId, name: "owner", displayName: "owner" },
    challenge,
    pubKeyCredParams: [{ type: "public-key", alg: ES256 }],
    authenticatorSelection: {
      authenticatorAttachment: attachment,
      residentKey: "required",
      userVerification: "required",
    },
    attestation: "none",
    timeout: TIMEOUT_MS,
  };
}

/** The options this page hands to `credentials.get` for the test signature. */
export function getOptions(rpId, challenge, credentialId) {
  return {
    rpId,
    challenge,
    allowCredentials: [{ type: "public-key", id: credentialId }],
    userVerification: "required",
    timeout: TIMEOUT_MS,
  };
}

function refused(reason) {
  return { state: { kind: "refused", reason }, stored: null };
}

/**
 * Read a created credential's response into a renderable state, or refuse it
 * with a single reason. The `stored` half is kept by the controller to verify
 * the test signature later, and is never shown.
 */
function inspectCreation(response, location) {
  const r = response.response;
  const getPublicKey =
    typeof r?.getPublicKey === "function" ? r.getPublicKey.bind(r) : null;
  if (getPublicKey === null) {
    return refused(
      "this browser does not return the public key; enrolment cannot be done here",
    );
  }
  let publicKey;
  try {
    publicKey = getPublicKey();
  } catch {
    return refused(
      "this browser does not return the public key; enrolment cannot be done here",
    );
  }
  if (publicKey === null || publicKey === undefined) {
    return refused(
      "this browser does not return the public key; enrolment cannot be done here",
    );
  }
  const spki = bytesToUint8(publicKey);
  const reason =
    "this browser does not return the public key; enrolment cannot be done here";
  if (typeof r?.getPublicKeyAlgorithm !== "function") {
    return refused(reason);
  }
  let algorithm;
  try {
    algorithm = r.getPublicKeyAlgorithm();
  } catch {
    return refused(reason);
  }
  if (algorithm !== ES256) {
    return refused("the passkey uses a key type this page does not support");
  }
  if (typeof r?.getAuthenticatorData !== "function") {
    return refused(reason);
  }
  let authDataBytes;
  try {
    authDataBytes = r.getAuthenticatorData();
  } catch {
    return refused(reason);
  }
  const authData = bytesToUint8(authDataBytes);
  const flags = flagsOf(authData[32]);
  if (!flags.userVerified) {
    return refused("this passkey was not user-verified");
  }
  const rawId = bytesToUint8(response.rawId);
  let transports = "not reported";
  if (typeof r.getTransports === "function") {
    const reported = r.getTransports();
    if (Array.isArray(reported) && reported.length > 0) {
      transports = reported.join(", ");
    }
  }
  let madeOn = "not reported";
  if (response.authenticatorAttachment === "platform") {
    madeOn = "this device";
  } else if (response.authenticatorAttachment === "cross-platform") {
    madeOn = "a separate security key or another device";
  }
  const credentialId = base64url(rawId);
  const publicKeySpki = base64(spki);
  const addedAt = nowIsoSeconds();
  const json = JSON.stringify({
    credentialId,
    publicKeySpki,
    label: "",
    addedAt,
  });
  return {
    state: {
      kind: "ready",
      credentialId,
      publicKeySpki,
      algorithm,
      transports,
      madeOn,
      userVerified: flags.userVerified,
      backupEligible: flags.backupEligible,
      backedUp: flags.backedUp,
      json,
      addedAt,
    },
    stored: { rawId, spki, rpId: location.hostname, origin: location.origin },
  };
}

function errorName(error) {
  if (error !== null && typeof error?.name === "string" && error.name) {
    return error.name;
  }
  return "Error";
}

function errorMessage(error) {
  if (error !== null && typeof error?.message === "string" && error.message) {
    return error.message;
  }
  return String(error);
}

async function verifyAssertion(assertion, ctx) {
  const { crypto, rawId, spki, rpId, origin, challenge } = ctx;
  const r = assertion.response;
  const clientDataBytes = bytesToUint8(r.clientDataJSON);
  const authData = bytesToUint8(r.authenticatorData);
  const signature = bytesToUint8(r.signature);
  const checks = [];

  const respId = bytesToUint8(assertion.rawId);
  checks.push({
    label: "credential id",
    ok: bytesEqual(respId, rawId),
    detail: bytesEqual(respId, rawId)
      ? undefined
      : "the credential id does not match",
  });

  let clientData;
  let clientDataParsed = true;
  try {
    clientData = JSON.parse(bytesToString(clientDataBytes));
  } catch {
    clientDataParsed = false;
    checks.push({
      label: "client data",
      ok: false,
      detail: "clientDataJSON is not JSON",
    });
  }
  if (
    clientDataParsed &&
    (clientData === null ||
      typeof clientData !== "object" ||
      Array.isArray(clientData))
  ) {
    checks.push({
      label: "client data",
      ok: false,
      detail: "clientDataJSON is not an object",
    });
  } else if (clientDataParsed) {
    let ok = true;
    let detail = "";
    if (clientData.type !== "webauthn.get") {
      ok = false;
      detail = `type is ${clientData.type}`;
    } else if (clientData.origin !== origin) {
      ok = false;
      detail = `origin is ${clientData.origin}`;
    } else if (clientData.challenge !== base64url(challenge)) {
      ok = false;
      detail = "challenge does not match";
    }
    checks.push({
      label: "client data",
      ok,
      detail: ok ? undefined : detail,
    });
  }

  const expectedRpId = new Uint8Array(
    await crypto.subtle.digest("SHA-256", asciiBytes(rpId)),
  );
  const rpIdOk = bytesEqual(authData.subarray(0, 32), expectedRpId);
  checks.push({
    label: "rpId hash",
    ok: rpIdOk,
    detail: rpIdOk ? undefined : "the rpId hash does not match",
  });

  const authFlags = flagsOf(authData[32]);
  checks.push({
    label: "user verified",
    ok: authFlags.userVerified,
    detail: authFlags.userVerified
      ? undefined
      : "the assertion was not user-verified",
  });

  let sigOk = false;
  let sigDetail = "the signature does not verify";
  try {
    const key = await crypto.subtle.importKey(
      "spki",
      spki,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const signed = concat(
      authData,
      new Uint8Array(await crypto.subtle.digest("SHA-256", clientDataBytes)),
    );
    const raw = derToRawP256(signature);
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      raw,
      signed,
    );
    sigOk = ok === true;
    if (!sigOk) {
      sigDetail = "the signature does not verify";
    }
  } catch (error) {
    sigDetail = errorMessage(error);
  }
  checks.push({
    label: "signature",
    ok: sigOk,
    detail: sigOk ? undefined : sigDetail,
  });

  return {
    kind: "verified",
    checks,
    userVerified: authFlags.userVerified,
    backupEligible: authFlags.backupEligible,
    backedUp: authFlags.backedUp,
  };
}

/**
 * The logic behind the `/enrol-key` page, handed the browser objects it reads
 * from so a test can pass fakes for all of them. `credentials` is
 * `navigator.credentials`, `crypto` is the WebCrypto global, and `location`
 * carries the origin and the hostname this page treats as its relying party id.
 */
export function enrolKey(credentials, crypto, location) {
  /** The credential a good create left, kept so `test` can ask for a signature. */
  let created = null;
  return {
    /** What the page shows before anything is pressed. */
    intro() {
      return {
        kind: "intro",
        origin: location.origin,
        rpId: location.hostname,
        publicKeyCredential: typeof PublicKeyCredential !== "undefined",
      };
    },
    /**
     * Make a passkey — on this device for `"platform"`, on a hardware security
     * key for `"cross-platform"` — returning the state to draw.
     */
    async create(attachment) {
      const challenge = randomBytes(crypto, CHALLENGE_LENGTH);
      const userId = randomBytes(crypto, USER_ID_LENGTH);
      const options = createOptions(
        location.hostname,
        challenge,
        userId,
        attachment,
      );
      let attestation;
      try {
        attestation = await credentials.create({ publicKey: options });
      } catch (error) {
        return {
          kind: "createError",
          name: errorName(error),
          message: errorMessage(error),
        };
      }
      const { state, stored } = inspectCreation(attestation, location);
      if (stored !== null) {
        created = stored;
      }
      return state;
    },
    /** Sign once with the created passkey, returning the checks to draw. */
    async test() {
      if (created === null) {
        throw new Error("no passkey has been created");
      }
      const challenge = randomBytes(crypto, CHALLENGE_LENGTH);
      const options = getOptions(created.rpId, challenge, created.rawId);
      let assertion;
      try {
        assertion = await credentials.get({ publicKey: options });
      } catch (error) {
        return {
          kind: "verified",
          checks: [
            {
              label: "sign",
              ok: false,
              detail: `${errorName(error)}: ${errorMessage(error)}`,
            },
          ],
          userVerified: false,
          backupEligible: false,
          backedUp: false,
        };
      }
      return verifyAssertion(assertion, {
        crypto,
        ...created,
        challenge,
        origin: created.origin,
      });
    },
  };
}

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
