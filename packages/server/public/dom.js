/**
 * The only way this UI touches the document. Every element is created here and
 * filled with `textContent` or with one of the attributes below, so no byte of
 * API data is ever parsed as HTML. Each allowed attribute has its own setter
 * with the name spelled out, which is what lets `eslint.config.js` refuse a
 * computed attribute name anywhere in `public/`: this table is the only way in.
 * `href` is deliberately absent: the two link helpers below are the only things
 * that may set one, and each decides the URL on its own terms.
 */

import { relativeTime } from "./format.js";

const SETTERS = {
  class: (node, value) => node.setAttribute("class", value),
  "data-label": (node, value) => node.setAttribute("data-label", value),
  "data-key": (node, value) => node.setAttribute("data-key", value),
  rel: (node, value) => node.setAttribute("rel", value),
  role: (node, value) => node.setAttribute("role", value),
  title: (node, value) => node.setAttribute("title", value),
  type: (node, value) => node.setAttribute("type", value),
  "aria-pressed": (node, value) => node.setAttribute("aria-pressed", value),
  "aria-label": (node, value) => node.setAttribute("aria-label", value),
  "aria-current": (node, value) => node.setAttribute("aria-current", value),
  "aria-live": (node, value) => node.setAttribute("aria-live", value),
  placeholder: (node, value) => node.setAttribute("placeholder", value),
  value: (node, value) => node.setAttribute("value", value),
  max: (node, value) => node.setAttribute("max", value),
  scope: (node, value) => node.setAttribute("scope", value),
  /**
   * These four name something in the document or address a control, so the
   * value must be one the app owns: a literal, or a segment already held to the
   * id patterns in `patterns.js`. An API string that reached one of them could
   * point a label at another project's control or claim a name this page uses.
   */
  name: (node, value) => node.setAttribute("name", value),
  for: (node, value) => node.setAttribute("for", value),
  id: (node, value) => node.setAttribute("id", value),
};

function attributes(node, values) {
  for (const [name, value] of Object.entries(values)) {
    const setter = SETTERS[name];
    if (setter === undefined) {
      throw new TypeError(`refusing to set attribute ${name}`);
    }
    setter(node, String(value));
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
 * parse, that parses to any protocol other than `https:`, or that carries a
 * username or a password, is not a link: a credential in a URL a stored field
 * controls is a phishing link wearing this app's name.
 */
export function httpsUrl(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      return undefined;
    }
    return url.username === "" && url.password === "" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function anchor(label, href, attrs = {}) {
  const node = el("a", {
    attrs: { class: "link", rel: "noopener noreferrer", ...attrs },
    text: label,
  });
  node.setAttribute("href", href);
  return node;
}

/**
 * A same-origin path, which the app owns and never takes from the API. It
 * carries `data-key="nav"`, which is how the shell's click handler knows this
 * is a link it may follow in place instead of letting the browser load the page
 * again. `repoLink` never carries it: an outbound link leaves the page.
 *
 * `attrs` goes through the table above like every other attribute, so a caller
 * can mark a link — `aria-current`, say — without a way in of its own.
 */
export function internalLink(label, path, attrs = {}) {
  const node = anchor(label, path, attrs);
  node.setAttribute("data-key", "nav");
  return node;
}

/** A repository the project registered: a link when it is `https:`, else text. */
export function repoLink(label, value) {
  const href = httpsUrl(value);
  return href === undefined ? text(label) : anchor(label, href);
}
