import { describe, expect, it } from "vitest";

import {
  el,
  httpsUrl,
  internalLink,
  repoLink,
  text,
} from "../../public/dom.js";

import { freshRoot, tagsIn, textOf } from "./helpers.js";

describe("el", () => {
  it("creates a bare element when given nothing", () => {
    const node = el("p");
    expect(node.tagName).toBe("P");
    expect(textOf(node)).toBe("");
    expect(node.getAttributeNames()).toStrictEqual([]);
  });

  it("sets text, allowed attributes and children", () => {
    const child = el("span", { text: "child" });
    const node = el("a", {
      text: "label",
      attrs: { class: "link", title: "t" },
      children: [child],
    });
    expect(node.getAttribute("class")).toBe("link");
    expect(node.getAttribute("title")).toBe("t");
    expect(textOf(node)).toBe("labelchild");
    expect(tagsIn(node)).toStrictEqual(["SPAN"]);
  });

  it("refuses any attribute outside the list, event handlers included", () => {
    for (const name of ["onclick", "style", "src", "srcdoc", "href", "id"]) {
      expect(() => el("p", { attrs: { [name]: "x" } })).toThrow(TypeError);
      expect(() => el("p", { attrs: { [name]: "x" } })).toThrow(name);
    }
  });

  it("stringifies whatever text() is handed", () => {
    expect(textOf(text(42))).toBe("42");
    expect(textOf(text(undefined))).toBe("undefined");
  });
});

describe("httpsUrl", () => {
  it("accepts an https URL and normalises it", () => {
    expect(httpsUrl("https://git.example.test/alpha")).toBe(
      "https://git.example.test/alpha",
    );
  });

  it("refuses every other protocol", () => {
    for (const value of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "http://git.example.test/alpha",
      "//git.example.test/alpha",
      "/relative",
      "not a url at all",
    ]) {
      expect(httpsUrl(value)).toBeUndefined();
    }
  });

  it("refuses anything that is not a string", () => {
    expect(httpsUrl(undefined)).toBeUndefined();
    expect(httpsUrl(7)).toBeUndefined();
  });
});

describe("links", () => {
  it("internal links carry the path the app owns", () => {
    const node = internalLink("alpha", "/p/alpha");
    expect(node.tagName).toBe("A");
    expect(node.getAttribute("href")).toBe("/p/alpha");
    expect(node.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("a repository is a link only when it is https", () => {
    const linked = repoLink("git", "https://git.example.test/alpha");
    expect(linked.tagName).toBe("A");
    expect(linked.getAttribute("href")).toBe("https://git.example.test/alpha");
  });

  it("anything else is text", () => {
    const plain = repoLink("javascript:alert(1)", "javascript:alert(1)");
    expect(plain.tagName).toBe("SPAN");
    expect(plain.hasAttribute("href")).toBe(false);
    expect(textOf(plain)).toBe("javascript:alert(1)");
  });
});

describe("the document the helper writes into", () => {
  it("is the page document", () => {
    const host = freshRoot();
    host.append(el("p", { text: "in the document" }));
    expect(textOf(host)).toContain("in the document");
  });
});
