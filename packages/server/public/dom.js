/**
 * The only way this UI touches the document. Every element is created here and
 * filled with `textContent` or with one of the attributes in `ATTRIBUTES`, so
 * no byte of API data is ever parsed as HTML. `href` is deliberately absent
 * from that set: the two link helpers below are the only things that may set
 * one, and each of them decides the URL on its own terms.
 */

import { relativeTime } from "./format.js";

const ATTRIBUTES = new Set([
  "class",
  "data-label",
  "rel",
  "role",
  "title",
  "type",
]);

function attributes(node, values) {
  for (const name of Object.keys(values)) {
    if (!ATTRIBUTES.has(name)) {
      throw new TypeError(`refusing to set attribute ${name}`);
    }
    node.setAttribute(name, String(values[name]));
  }
}

/**
 * `options` is `{ text?, attrs?, children? }`. A missing option is simply
 * absent, so every view can say only what it means.
 */
export function el(tag, options = {}) {
  const node = document.createElement(tag);
  attributes(node, options.attrs ?? {});
  if (options.text !== undefined) {
    node.textContent = options.text;
  }
  for (const child of options.children ?? []) {
    node.append(child);
  }
  return node;
}

export function text(value) {
  return el("span", { text: String(value) });
}

/** A relative time, with the exact stamp it came from in the title. */
export function stamp(iso, nowMs) {
  return el("span", {
    attrs: { title: iso ?? "" },
    text: relativeTime(iso, nowMs),
  });
}

/**
 * The address an outbound link may point at, or nothing. A URL that does not
 * parse, or that parses to any protocol other than `https:`, is not a link.
 */
export function httpsUrl(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function anchor(label, href) {
  const node = el("a", {
    attrs: { class: "link", rel: "noopener noreferrer" },
    text: label,
  });
  node.setAttribute("href", href);
  return node;
}

/** A same-origin path, which the app owns and never takes from the API. */
export function internalLink(label, path) {
  return anchor(label, path);
}

/** A repository the project registered: a link when it is `https:`, else text. */
export function repoLink(label, value) {
  const href = httpsUrl(value);
  return href === undefined ? text(label) : anchor(label, href);
}
