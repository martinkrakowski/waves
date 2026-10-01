import { describe, expect, it } from "vitest";

import { projectList, projectPath } from "../../public/projects.js";

import { NOW_ISO, NOW_MS, projectCard } from "./fixtures.js";
import {
  assertNoInjectedMarkup,
  freshRoot,
  oneOf,
  textOf,
  textsOf,
} from "./helpers.js";

function render(...projects: ReturnType<typeof projectCard>[]): HTMLElement {
  const host = freshRoot();
  host.append(projectList(projects, NOW_MS));
  assertNoInjectedMarkup();
  return host;
}

describe("the project list", () => {
  it("says so when nothing is registered", () => {
    const host = render();
    expect(textOf(oneOf(host, ".empty"))).toBe("No projects registered yet.");
    expect(host.querySelectorAll(".cards")).toHaveLength(0);
    expect(host.querySelectorAll(".count")).toHaveLength(0);
  });

  it("gives one card per project, with every fact on it", () => {
    const host = render(
      projectCard(),
      projectCard({
        id: "beta",
        name: "Beta",
        repo: "https://git.example.test/beta",
        waves: 1,
        lastPush: "2026-04-01T11:00:00.000Z",
      }),
    );
    const cards = host.querySelectorAll(".card");
    expect(cards).toHaveLength(2);
    expect(textOf(oneOf(host, ".count"))).toBe("2 projects");

    const first = cards[0] as HTMLElement;
    expect(textsOf(first, "a")).toStrictEqual([
      "Alpha",
      "https://git.example.test/alpha",
    ]);
    expect(first.querySelector("a")?.getAttribute("href")).toBe("/p/alpha");
    expect(textsOf(first, "code")).toStrictEqual(["alpha"]);
    expect(textsOf(first, "dt")).toStrictEqual([
      "id",
      "repo",
      "waves",
      "last push",
    ]);
    expect(textsOf(first, "dd")[2]).toBe("3 waves");
    expect(textsOf(first, "dd")[3]).toBe("2m ago");
    expect(textsOf(host, "dd")[6]).toBe("1 wave");
  });

  it("puts the exact push time in the title of the relative one", () => {
    const host = render(projectCard({ lastPush: "2026-04-01T11:58:00.000Z" }));
    const stamp = oneOf(host, "dd span[title]");
    expect(textOf(stamp)).toBe("2m ago");
    expect(stamp?.getAttribute("title")).toBe("2026-04-01T11:58:00.000Z");
  });

  it("says never when the project has pushed nothing", () => {
    const host = render(projectCard({ waves: 0, lastPush: undefined }));
    expect(textsOf(host, "dd")[3]).toBe("never");
  });

  it("badges the newest wave as stale when the summary says so", () => {
    const host = render(projectCard({ stale: true }));
    expect(textsOf(host, ".badge")).toStrictEqual(["stale"]);
    expect(oneOf(host, ".badge")?.getAttribute("class")).toBe("badge stale");
  });

  it("badges nothing when the summary is silent about staleness", () => {
    const host = render(projectCard());
    expect(host.querySelectorAll(".badge")).toHaveLength(0);
  });

  it("counts one project as one project", () => {
    expect(textOf(oneOf(render(projectCard()), ".count"))).toBe("1 project");
  });

  it("links the repository only when it is https", () => {
    const host = render(
      projectCard({ id: "http", repo: "http://git.example.test/http" }),
      projectCard({ id: "js", repo: "javascript:alert(1)" }),
      projectCard({ id: "none", repo: undefined }),
    );
    expect(textsOf(host, "a")).toStrictEqual(["Alpha", "Alpha", "Alpha"]);
    expect(textsOf(host, "dd")[1]).toBe("http://git.example.test/http");
    expect(textsOf(host, "dd")[5]).toBe("javascript:alert(1)");
    expect(textsOf(host, "dd")[9]).toBe("no repository registered");

    const withHttps = render(projectCard());
    expect(textsOf(withHttps, "a")).toStrictEqual([
      "Alpha",
      "https://git.example.test/alpha",
    ]);
  });
});

describe("projectPath", () => {
  it("is the route the server answers with the page", () => {
    expect(projectPath("alpha")).toBe("/p/alpha");
  });

  it("encodes whatever the id carries", () => {
    expect(projectPath("a/b c?d")).toBe("/p/a%2Fb%20c%3Fd");
  });

  it("is the href the card links to", () => {
    const host = render(projectCard({ id: "a b" }));
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/p/a%20b");
    expect(NOW_ISO).not.toBe("");
  });
});
