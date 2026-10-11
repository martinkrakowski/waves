/**
 * The `/enrol-key` page's view: it draws only the state the logic module
 * (`enrol-key.js`) hands it, with no API call of its own. Buttons call back
 * through `handlers`, which the app wires to the logic; the page never reads
 * or writes storage, and never touches `innerHTML`.
 */

import { el, text } from "../dom.js";

const PAGE_TITLE = "Enrol an owner key";
const SENDS_NOTHING =
  "This page sends nothing to the server: it signs nothing and stores no key.";
const NO_PUBLIC_KEY =
  "PublicKeyCredential is not available in this browser; a passkey cannot be made here.";
const FOOTER =
  "This page shows a public key; copy it only from this screen. The key is " +
  "pinned by your own hand in three places: the server's Secret, " +
  "/etc/waves/owner-keys.json on the laptop, and the fleet registry. A " +
  "passkey that can be synced to other devices may also be usable from them " +
  "— confirm with the session that prepared this before pinning it.";

/** A button the page owns, with the data-key the shell's focus logic reads. */
function button(label, dataKey, onClick) {
  const node = el("button", {
    attrs: {
      class: "enrol-button",
      type: "button",
      "data-key": dataKey,
    },
    text: label,
  });
  node.addEventListener("click", onClick);
  return node;
}

/** A labelled value, shown as selectable text in a `<code>`. */
function field(label, value) {
  return el("p", {
    attrs: { class: "enrol-field" },
    children: [text(`${label}: `), el("code", { text: String(value) })],
  });
}

/** A yes/no flag, drawn the same way as the other fields. */
function flagRow(label, value) {
  return field(label, value ? "yes" : "no");
}

/** One line of the test-signature checks: "label: ok" or "label: what failed". */
function checkRow(check) {
  return el("p", {
    attrs: {
      class: check.ok ? "enrol-check ok" : "enrol-check fail",
    },
    children: [
      text(`${check.label}: `),
      text(check.ok ? "ok" : (check.detail ?? "failed")),
    ],
  });
}

function heading(state) {
  const title =
    state.kind === "intro"
      ? PAGE_TITLE
      : state.kind === "ready"
        ? "Passkey created"
        : state.kind === "verified"
          ? "Signature checked"
          : state.kind === "refused"
            ? "Passkey refused"
            : "Create failed";
  return el("h1", { text: title });
}

/**
 * The two create buttons the page offers wherever it offers one: on this
 * device, or on a hardware security key. Each calls its own handler.
 */
function createButtons(handlers) {
  return [
    button("Create a passkey on this device", "create", handlers.onCreate),
    button(
      "Create on a hardware security key",
      "create-roaming",
      handlers.onCreateRoaming,
    ),
  ];
}

function intro(state, handlers) {
  const children = [
    field("Origin", state.origin),
    field("Relying party id", state.rpId),
    el("p", { attrs: { class: "enrol-sends" }, text: SENDS_NOTHING }),
  ];
  if (state.publicKeyCredential) {
    children.push(...createButtons(handlers));
  } else {
    children.push(
      el("p", { attrs: { class: "enrol-refused" }, text: NO_PUBLIC_KEY }),
    );
  }
  return children;
}

function ready(state, handlers) {
  return [
    field("Credential id", state.credentialId),
    field("Public key (SPKI)", state.publicKeySpki),
    field("Algorithm", state.algorithm),
    field("Transports", state.transports),
    field("made on", state.madeOn),
    flagRow("User verified", state.userVerified),
    flagRow(
      "Can be synced to other devices (backup eligible)",
      state.backupEligible,
    ),
    flagRow("Is synced now (backed up)", state.backedUp),
    field("Enrolment JSON", state.json),
    button("Test: sign once with this passkey", "test", handlers.onVerify),
    el("p", { attrs: { class: "enrol-footer" }, text: FOOTER }),
  ];
}

function verified(state, handlers) {
  return [
    ...state.checks.map(checkRow),
    flagRow("User verified", state.userVerified),
    flagRow(
      "Can be synced to other devices (backup eligible)",
      state.backupEligible,
    ),
    flagRow("Is synced now (backed up)", state.backedUp),
    el("p", { attrs: { class: "enrol-footer" }, text: FOOTER }),
    ...createButtons(handlers),
  ];
}

/**
 * Draw the `/enrol-key` page from its state. `handlers.onCreate` makes a
 * passkey on this device and `handlers.onCreateRoaming` one on a hardware
 * security key; `handlers.onVerify` tests the key that was made; all resolve
 * to a state the app hands back here to redraw.
 */
export function renderEnrolKey(state, handlers) {
  const children = [heading(state)];
  if (state.kind === "intro") {
    children.push(...intro(state, handlers));
  } else if (state.kind === "ready") {
    children.push(...ready(state, handlers));
  } else if (state.kind === "verified") {
    children.push(...verified(state, handlers));
  } else if (state.kind === "refused") {
    children.push(
      el("p", { attrs: { class: "enrol-refused" }, text: state.reason }),
      ...createButtons(handlers),
    );
  } else {
    children.push(
      el("p", {
        attrs: { class: "enrol-refused" },
        text: `${state.name}: ${state.message}`,
      }),
      ...createButtons(handlers),
    );
  }
  return el("section", { attrs: { class: "view enrol-key" }, children });
}
