import {
  decisionBindingText,
  validateDecision,
  validateOwnerKeys,
  type OwnerKeys,
} from "@hexagen-monaco/waves-contract";

import type { Command } from "../domain/args.js";
import { isRecord, own } from "../domain/object.js";
import {
  checkAssertion,
  chooseSignedAnswer,
  issuesSentence,
  toHex,
  utf8Bytes,
} from "../domain/signed-answer.js";
import { EXIT_OK, EXIT_UNVERIFIED, EXIT_UNSIGNED } from "./errors.js";
import type { PinRead, UseCaseDeps } from "./ports.js";

type ReadCommand = Extract<
  Command,
  { readonly kind: "decision"; readonly action: "read" }
>;

/** The pin file's path, as the reader prints it: the design's constant, 6.1. */
const PIN_PATH = "/etc/waves/owner-keys.json";
const LABEL = "waves decision read";

/** The group- and other-write bits: either one on the pin file refuses it. */
const WRITABLE_BY_OTHERS = 0o022;

/**
 * `waves decision read --signed` (design 5.3, W63): the record is already
 * fetched and checked by `read`, and this use case is everything the reader
 * verifies for itself and nothing the server said that it can recompute.
 *
 * The pin file is read and held to its rules first, so a bad pin file is exit 3
 * even when nothing is signed. Then the current revision's own text is hashed
 * again — the stored hash is never trusted — and the last `signed` entry on
 * that revision must carry that hash, sit at the index it signed, and hold an
 * assertion whose challenge, origin, relying party, flags and ES256 signature
 * all check against a key pinned outside the server.
 *
 * Every refusal is one sentence on `err` with the command's label, and stdout
 * stays empty: exit 3 names the check that failed, exit 4 says no signed answer
 * is on the current text, and exit 0 prints the answer — and any session entry
 * that sits over it — without ever printing a warning instead of refusing.
 */
export async function readSigned(
  command: ReadCommand,
  deps: UseCaseDeps,
  record: Record<string, unknown>,
  project: string,
): Promise<number> {
  const refuse = (sentence: string, code: number): number => {
    deps.err(`${LABEL}: ${sentence}`);
    return code;
  };

  const pin = await deps.ownerPins.read();
  const pinned = pinnedKeysOf(pin);
  if (typeof pinned === "string") {
    return refuse(pinned, EXIT_UNVERIFIED);
  }

  const revisions = record.revisions as readonly unknown[];
  const entries = record.entries as readonly unknown[];
  const last =
    revisions.length === 0 ? undefined : revisions[revisions.length - 1];
  if (last === undefined) {
    return refuse("no signed answer on the current text", EXIT_UNSIGNED);
  }
  if (!isRecord(last)) {
    return refuse(
      "the record's current revision is not an object",
      EXIT_UNVERIFIED,
    );
  }

  const decision = validateDecision(own(last, "decision"));
  if (!decision.ok) {
    return refuse(
      `the current revision is not a valid decision: ${issuesSentence(decision.errors)}`,
      EXIT_UNVERIFIED,
    );
  }
  const textSha256 = toHex(
    deps.crypto.sha256(utf8Bytes(decisionBindingText(decision.value))),
  );
  if (own(last, "textSha256") !== textSha256) {
    return refuse(
      "the revision's stored textSha256 does not match its own text",
      EXIT_UNVERIFIED,
    );
  }
  const revision = own(last, "revision") as number;

  const choice = chooseSignedAnswer(entries, revision, textSha256);
  if (!choice.ok) {
    if ("none" in choice) {
      return refuse("no signed answer on the current text", EXIT_UNSIGNED);
    }
    return refuse(choice.reason, EXIT_UNVERIFIED);
  }

  const key = pinned.keys.find(
    (candidate) => candidate.credentialId === choice.signature.credentialId,
  );
  if (key === undefined) {
    return refuse(
      `no pinned key has credential id ${choice.signature.credentialId}`,
      EXIT_UNVERIFIED,
    );
  }

  const assertion = checkAssertion(deps.crypto, {
    project,
    decision: command.id,
    textSha256,
    entry: choice.entry,
    signature: choice.signature,
    verdict: choice.verdict,
    key,
  });
  if (!assertion.ok) {
    return refuse(assertion.reason, EXIT_UNVERIFIED);
  }

  deps.out(`signed answer: ${choice.verdict}`);
  if (choice.entry.option !== undefined) {
    deps.out(`option: ${choice.entry.option}`);
  }
  if (choice.entry.words !== undefined) {
    deps.out(`words: ${choice.entry.words}`);
  }
  deps.out(`signed with: ${key.label}`);
  if (key.retired === true) {
    deps.out("signed with a retired key");
  }
  deps.out(`verified against ${PIN_PATH}`);

  const afterwards = sessionEntryOver(choice.position, entries, revision);
  if (afterwards !== undefined) {
    deps.out(
      `afterwards, a session recorded: ${String(own(afterwards, "state"))} by ${String(own(afterwards, "by"))} at ${String(own(afterwards, "at"))}`,
    );
    if (own(afterwards, "reason") !== undefined) {
      deps.out(`reason: ${String(own(afterwards, "reason"))}`);
    }
  }
  return EXIT_OK;
}

/**
 * The pin file's rules (design 6.1): a regular file, owned by root, writable
 * by neither group nor others, holding an owner-keys document the contract
 * accepts. Each refusal is its own sentence, because each is something the
 * owner can fix with `chown`, `chmod` or an editor — and none of them is
 * anything a session can fix, which is the point of reading it here.
 */
function pinnedKeysOf(pin: PinRead): OwnerKeys | string {
  if (pin.kind === "missing") {
    return `the pin file ${PIN_PATH} is missing`;
  }
  if (pin.type !== "file") {
    return pin.type === "symlink"
      ? `the pin file ${PIN_PATH} is a symbolic link`
      : `the pin file ${PIN_PATH} is not a regular file`;
  }
  if (pin.uid !== 0) {
    return `the pin file ${PIN_PATH} is owned by uid ${pin.uid}, not by root`;
  }
  if ((pin.mode & WRITABLE_BY_OTHERS) !== 0) {
    return `the pin file ${PIN_PATH} is writable by group or others (mode 0${(pin.mode & 0o777).toString(8)})`;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(pin.text ?? "");
  } catch {
    return `the pin file ${PIN_PATH} is not valid JSON`;
  }
  const validated = validateOwnerKeys(parsed);
  if (!validated.ok) {
    return `the pin file ${PIN_PATH} is not a valid owner-keys document: ${issuesSentence(validated.errors)}`;
  }
  return validated.value;
}

/**
 * The last `withdrawn` or `superseded` entry a session wrote over the signed
 * answer, on the same text. It does not change what the signature means (6.2),
 * so it is printed after the answer and the exit stays 0.
 *
 * No entry with `source: "signed"` is looked for here, and none can be seen:
 * the chooser takes the last signed entry of the current revision, so any
 * entry after the chosen one with `source: "signed"` would have been chosen
 * itself — and a chosen entry that is not an answer state is refused before
 * this scan ever runs.
 */
function sessionEntryOver(
  position: number,
  entries: readonly unknown[],
  revision: number,
): Record<string, unknown> | undefined {
  let found: Record<string, unknown> | undefined;
  for (let index = position + 1; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!isRecord(entry)) {
      continue;
    }
    const state = own(entry, "state");
    if (
      (state === "withdrawn" || state === "superseded") &&
      own(entry, "revision") === revision
    ) {
      found = entry;
    }
  }
  return found;
}
