import { afterEach, describe, expect, it, vi } from "vitest";

import { projectCard } from "./fixtures.js";
import { fetchStub, flush, freshRoot, root, textsOf } from "./helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the page entry point", () => {
  it("boots the app on the page's own globals", async () => {
    freshRoot();
    const fetchImpl = fetchStub(() => ({
      status: 200,
      body: [projectCard()],
    }));
    vi.stubGlobal("fetch", fetchImpl);

    const { app } = await import("../../public/main.js");
    await flush();

    expect(app.route).toStrictEqual({ kind: "projects" });
    expect(fetchImpl.calls).toStrictEqual(["/api/v1/projects"]);
    expect(textsOf(root(), ".card-name")).toStrictEqual(["Alpha"]);
    app.stop();
  });
});
