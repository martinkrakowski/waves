import { describe, expect, it } from "vitest";

import type { FetchLike } from "../../public/api.js";
import { createApi } from "../../public/api.js";

import { projectCard, waveSummary, waveView } from "./fixtures.js";

interface Seen {
  readonly path: string;
  readonly accept: string | undefined;
}

function recorder(answer: { status: number; body?: unknown }): {
  fetch: FetchLike;
  seen: Seen[];
} {
  const seen: Seen[] = [];
  const fetchImpl: FetchLike = (path, init) => {
    seen.push({ path, accept: init?.headers?.accept });
    return Promise.resolve({
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: () => Promise.resolve(answer.body),
    });
  };
  return { fetch: fetchImpl, seen };
}

describe("createApi", () => {
  it("asks for JSON from the three read endpoints", async () => {
    const { fetch: fetchImpl, seen } = recorder({ status: 200, body: [] });
    const api = createApi(fetchImpl);
    await api.projects();
    await api.waves("alpha");
    await api.wave("alpha", "w-3");
    expect(seen).toStrictEqual([
      { path: "/api/v1/projects", accept: "application/json" },
      { path: "/api/v1/projects/alpha/waves", accept: "application/json" },
      { path: "/api/v1/projects/alpha/waves/w-3", accept: "application/json" },
    ]);
  });

  it("percent-encodes the ids it puts in a path", async () => {
    const { fetch: fetchImpl, seen } = recorder({ status: 200, body: [] });
    const api = createApi(fetchImpl);
    await api.waves("a/b?c=d");
    await api.wave("a/b?c=d", "w 1");
    expect(seen.map((entry) => entry.path)).toStrictEqual([
      "/api/v1/projects/a%2Fb%3Fc%3Dd/waves",
      "/api/v1/projects/a%2Fb%3Fc%3Dd/waves/w%201",
    ]);
  });

  it("returns the decoded body", async () => {
    const body = [projectCard()];
    const { fetch: fetchImpl } = recorder({ status: 200, body });
    await expect(createApi(fetchImpl).projects()).resolves.toStrictEqual(body);
  });

  it("reads a 404 as nothing rather than as an error", async () => {
    const { fetch: fetchImpl } = recorder({ status: 404 });
    const api = createApi(fetchImpl);
    await expect(api.waves("nope")).resolves.toBeUndefined();
    await expect(api.wave("nope", "w-1")).resolves.toBeUndefined();
  });

  it("throws on any other unhappy status", async () => {
    const { fetch: fetchImpl } = recorder({ status: 503 });
    await expect(createApi(fetchImpl).projects()).rejects.toThrow(
      "GET /api/v1/projects answered 503",
    );
  });

  it("keeps the shape the read model promises", async () => {
    const waves = [waveSummary()];
    const view = waveView();
    const bodies: Readonly<Record<string, unknown>> = {
      "/api/v1/projects/alpha/waves": waves,
      "/api/v1/projects/alpha/waves/w-3": view,
    };
    const api = createApi((path) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(bodies[path]),
      }),
    );
    expect(await api.waves("alpha")).toStrictEqual(waves);
    expect(await api.wave("alpha", "w-3")).toStrictEqual(view);
  });
});
