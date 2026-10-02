import { describe, expect, it } from "vitest";

import { logo } from "../../public/logo.js";

const NS = "http://www.w3.org/2000/svg";

const D = [
  "M2 8c1.7-2.7 3.3-2.7 5 0s3.3 2.7 5 0 3.3-2.7 5 0 3.3 2.7 5 0",
  "M2 13c1.7-2.7 3.3-2.7 5 0s3.3 2.7 5 0 3.3-2.7 5 0 3.3 2.7 5 0",
  "M2 18c1.7-2.7 3.3-2.7 5 0s3.3 2.7 5 0 3.3-2.7 5 0 3.3 2.7 5 0",
];

describe("the mark", () => {
  it("is an svg, not an HTML element", () => {
    const svg = logo();
    expect(svg.namespaceURI).toBe(NS);
    expect(svg.tagName).toBe("svg");
  });

  it("carries exactly the four attributes it needs, and nothing else", () => {
    const svg = logo();
    expect(svg.getAttributeNames().sort()).toStrictEqual([
      "aria-hidden",
      "class",
      "focusable",
      "viewBox",
    ]);
    expect(svg.getAttribute("class")).toBe("logo");
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
  });

  it("is three waves, a line lower each time, and says nothing", () => {
    const paths = logo().children;
    expect(paths).toHaveLength(3);
    expect(
      Array.from(paths).map((path) => (path as Element).namespaceURI),
    ).toStrictEqual([NS, NS, NS]);
    expect(
      Array.from(paths).map((path) => (path as Element).getAttribute("d")),
    ).toStrictEqual(D);
    for (const path of paths) {
      expect(path.getAttributeNames()).toStrictEqual(["d"]);
      expect(path.textContent).toBe("");
    }
  });

  it("takes nothing from anywhere", () => {
    // No argument, so no API string and no address can reach it: two marks built
    // back to back are the same mark.
    expect(logo().outerHTML).toBe(logo().outerHTML);
    expect(logo()).not.toBe(logo());
  });
});
