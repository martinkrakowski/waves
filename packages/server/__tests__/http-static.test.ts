import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readStaticFile } from "../src/infrastructure/http-static.js";
import { cleanupHarnesses, startHarness } from "./http-harness.js";

const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

function statusOf(raw: string): number {
  return Number(raw.split(" ")[1]);
}

function bodyOf(raw: string): string {
  return raw.split("\r\n\r\n").slice(1).join("\r\n\r\n");
}

afterEach(cleanupHarnesses);

describe("the placeholder page", () => {
  it("serves the page at the root and at a project", async () => {
    const started = await startHarness();

    for (const path of ["/", "/p/alpha"]) {
      const response = await fetch(`${started.origin}${path}`);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(
        "text/html; charset=utf-8",
      );
      expect(response.headers.get("content-security-policy")).toBe(CSP);
      expect(response.headers.get("cache-control")).toBeNull();
      expect(await response.text()).toContain("<title>waves</title>");
    }
  });

  it("refuses a project page whose id the contract rejects", async () => {
    const started = await startHarness();

    expect((await fetch(`${started.origin}/p/Bad%20Id`)).status).toBe(404);
    expect((await fetch(`${started.origin}/p/`)).status).toBe(404);
  });

  it("serves the linked assets with a fixed content type", async () => {
    const started = await startHarness();

    const script = await fetch(`${started.origin}/app.js`);
    const style = await fetch(`${started.origin}/app.css`);

    expect(script.headers.get("content-type")).toBe(
      "text/javascript; charset=utf-8",
    );
    expect(style.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(await script.text()).toContain("use strict");
  });

  it("answers HEAD for the page with no body", async () => {
    const started = await startHarness();

    const response = await fetch(`${started.origin}/`, { method: "HEAD" });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(Number(response.headers.get("content-length"))).toBeGreaterThan(0);
    expect(await response.text()).toBe("");
  });
});

describe("the static file rules", () => {
  it.each([
    ["/../package.json", "a dot segment"],
    ["/%2e%2e/package.json", "an encoded dot segment"],
    ["/a%2fb", "an encoded slash"],
    ["/..%5cx", "an encoded backslash"],
    ["/x%00.js", "an encoded NUL"],
    ["//etc/passwd", "an absolute looking path"],
    ["/main.ts", "an extension that is not allow-listed"],
    ["/dir.js", "a directory whose name carries an allowed extension"],
    ["/app.js/nested.js", "a path through a file"],
    ["/%zz", "a malformed escape"],
    ["/a/b", "a path that names no file"],
  ])("refuses %s (%s)", async (path) => {
    const started = await startHarness();

    const raw = await started.raw(`GET ${path} HTTP/1.1`);

    expect(statusOf(raw)).toBe(404);
    expect(bodyOf(raw)).not.toContain("not-public");
    expect(raw).toContain("nosniff");
  });
});

describe("the file reader", () => {
  it("propagates a file system error it does not model", async () => {
    await expect(
      readStaticFile({
        path: join(tmpdir(), `${"a".repeat(5000)}.js`),
        type: "text/javascript; charset=utf-8",
      }),
    ).rejects.toThrow(/ENAMETOOLONG/);
  });
});

describe("the request log", () => {
  it("writes one json line per request without the query string", async () => {
    const started = await startHarness();
    await fetch(`${started.origin}/api/v1/projects?token=leak-me`);
    await fetch(`${started.origin}/app.js`);

    const lines = started.logLines().map((line) => JSON.parse(line));

    expect(lines).toEqual([
      {
        ts: expect.any(String),
        method: "GET",
        path: "/api/v1/projects",
        status: 200,
        ms: expect.any(Number),
      },
      {
        ts: expect.any(String),
        method: "GET",
        path: "/app.js",
        status: 200,
        ms: expect.any(Number),
      },
    ]);
    expect(started.logLines().join("\n")).not.toContain("leak-me");
  });
});
