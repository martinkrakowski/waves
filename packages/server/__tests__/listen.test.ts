import { describe, expect, it } from "vitest";

import { listen, type ListenableServer } from "../src/infrastructure/listen.js";

type Listener = (...args: unknown[]) => void;

class FakeServer implements ListenableServer {
  readonly #listeners = new Map<string, Listener[]>();
  host = "";
  port = 0;
  failure: unknown;

  once(event: string, listener: Listener): this {
    const known = this.#listeners.get(event) ?? [];
    known.push(listener);
    this.#listeners.set(event, known);
    return this;
  }

  off(event: string, listener: Listener): this {
    const known = this.#listeners.get(event) ?? [];
    this.#listeners.set(
      event,
      known.filter((candidate) => candidate !== listener),
    );
    return this;
  }

  listen(port: number, host: string, listener: () => void): this {
    this.port = port;
    this.host = host;
    if (this.failure === undefined) {
      queueMicrotask(listener);
      return this;
    }
    const failure = this.failure;
    queueMicrotask(() => {
      for (const known of this.#listeners.get("error") ?? []) {
        known(failure);
      }
    });
    return this;
  }

  countOf(event: string): number {
    return (this.#listeners.get(event) ?? []).length;
  }
}

function bindFailure(code: string): Error {
  return Object.assign(new Error(`bind ${code}`), { code });
}

describe("listen", () => {
  it("reports a bound server and drops the error listener", async () => {
    const server = new FakeServer();

    await expect(listen(server, "127.0.0.1", 18080)).resolves.toEqual({
      ok: true,
    });
    expect(server.host).toBe("127.0.0.1");
    expect(server.port).toBe(18080);
    expect(server.countOf("error")).toBe(0);
  });

  it.each(["EADDRINUSE", "EACCES", "EADDRNOTAVAIL"])(
    "turns %s into a message that names the address",
    async (code) => {
      const server = new FakeServer();
      server.failure = bindFailure(code);

      await expect(listen(server, "0.0.0.0", 18080)).resolves.toEqual({
        ok: false,
        message: `cannot listen on 0.0.0.0:18080: ${code}`,
      });
    },
  );

  it.each([
    ["an error without a code", new Error("something else")],
    ["an error with another code", bindFailure("EMFILE")],
  ])("passes on %s", async (_label, failure) => {
    const server = new FakeServer();
    server.failure = failure;

    await expect(listen(server, "0.0.0.0", 18080)).rejects.toThrow(failure);
  });
});
