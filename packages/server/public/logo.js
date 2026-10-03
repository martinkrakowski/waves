/**
 * The waves mark: three wavy lines in a box, beside the word `waves` in the top
 * bar. Decorative, so it is hidden from assistive tech and takes no focus.
 *
 * The mark is built as an inline SVG in the document rather than fetched, and
 * the reason is the colour, not the policy: `currentColor` reaches an SVG from
 * the stylesheet, so the mark is whatever `--text` says in either scheme, and
 * an inline element costs no request. The CSP is not what forbids an image —
 * `img-src 'self'` would allow a same-origin `<img>` — but a data URI would be
 * blocked, and a fetched file would be a request for three constants.
 *
 * This does not go through `dom.js`, whose `el()` makes HTML elements, and that
 * is not an exception to it: `createElementNS` in the SVG namespace with
 * `setAttribute` on literal names and literal values is exactly what `dom.js`
 * does for an HTML element. Nothing here is computed — no name from the API, no
 * value from the address, no argument at all — so there is nothing for a stored
 * payload to travel on, and the whole mark is three constants and a namespace.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/** The same wave three times, a line lower each time: 24 units square. */
const WAVES = [
  "M2 8c1.7-2.7 3.3-2.7 5 0s3.3 2.7 5 0 3.3-2.7 5 0 3.3 2.7 5 0",
  "M2 13c1.7-2.7 3.3-2.7 5 0s3.3 2.7 5 0 3.3-2.7 5 0 3.3 2.7 5 0",
  "M2 18c1.7-2.7 3.3-2.7 5 0s3.3 2.7 5 0 3.3-2.7 5 0 3.3 2.7 5 0",
];

export function logo() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "logo");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const d of WAVES) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}
