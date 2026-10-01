import { describe, expect, it } from "vitest";

import { remove } from "../src/application/delete.js";
import type { Command } from "../src/domain/args.js";
import type {
  HttpRequest,
  TransportOptions,
} from "../src/application/ports.js";
import {
  CONFIG_DIR,
  PROJECT,
  PROJECT_TOKEN,
  WAVE,
  harness,
  network,
  reply,
} from "./support/harness.js";

type DeleteCommand = Extract<Command, { readonly kind: "delete" }>;

const tokenPath = `${CONFIG_DIR}/${PROJECT}.token`;

function command(): DeleteCommand {
  return { kind: "delete", wave: WAVE };
}

function capturing(outcome: ReturnType<typeof reply>) {
  const sent: {
    readonly options: TransportOptions;
    readonly request: HttpRequest;
  }[] = [];
  const built = harness({
    script: [outcome],
    files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
  });
  const deps = {
    ...built.deps,
    transport: (options: TransportOptions) => ({
      send: async (request: HttpRequest) => {
        sent.push({ options, request });
        return outcome;
      },
    }),
  };
  return { sent, deps };
}

describe("delete", () => {
  it("asks the server to drop one wave, with no body and no envelope", async () => {
    const { sent, deps } = capturing(reply(204));
    expect(await remove(command(), deps)).toBe(0);
    expect(sent).toEqual([
      {
        options: {
          origin: "http://127.0.0.1:8080",
          ca: undefined,
          warnInsecure: undefined,
        },
        request: {
          method: "DELETE",
          url: `http://127.0.0.1:8080/api/v1/projects/${PROJECT}/waves/${WAVE}`,
          bearer: PROJECT_TOKEN,
        },
      },
    ]);
  });

  it("reports a wave that is gone", async () => {
    const built = harness({
      script: [reply(404, '{"message":"no such wave"}')],
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });
    await expect(remove(command(), built.deps)).rejects.toThrow(
      `delete failed: 404 Not Found; ${PROJECT}/${WAVE} is not stored`,
    );
  });

  it("reports a refusal with its pointers", async () => {
    const built = harness({
      script: [reply(401, "")],
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });
    await expect(remove(command(), built.deps)).rejects.toThrow(
      "delete failed: 401 Unauthorized",
    );
  });

  it("reports a refusal it cannot explain", async () => {
    const broken = reply(500, "not json at all");
    const built = harness({
      script: [broken, broken, broken],
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });
    await expect(remove(command(), built.deps)).rejects.toThrow(
      "delete failed: 500 Internal Server Error",
    );
    expect(built.sent()).toBe(3);
  });

  it("reports a network failure after two retries", async () => {
    const lost = network("socket hang up");
    const built = harness({
      script: [lost, lost, lost],
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });
    await expect(remove(command(), built.deps)).rejects.toThrow(
      "delete failed: socket hang up",
    );
    expect(built.sent()).toBe(3);
    expect(built.waits).toEqual([1000, 2000]);
  });

  it("repeats a deletion after a 5xx, because a deletion is idempotent", async () => {
    const built = harness({
      script: [reply(503, ""), reply(204)],
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });
    expect(await remove(command(), built.deps)).toBe(0);
    expect(built.sent()).toBe(2);
    expect(built.waits).toEqual([1000]);
  });

  it("does not repeat a deletion the server refused", async () => {
    const built = harness({
      script: [reply(403, '{"error":"another project\'s token"}'), reply(204)],
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });
    await expect(remove(command(), built.deps)).rejects.toThrow(
      "delete failed: 403 Forbidden\n  another project's token",
    );
    expect(built.sent()).toBe(1);
    expect(built.waits).toEqual([]);
  });

  it("says nothing on stderr and names what it dropped", async () => {
    const built = harness({
      script: [reply(204)],
      files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    });
    expect(await remove(command(), built.deps)).toBe(0);
    expect(built.out).toEqual([`deleted ${PROJECT}/${WAVE}`]);
    expect(built.err).toEqual([]);
  });

  it("wants the same token as a push", async () => {
    const built = harness();
    await expect(remove(command(), built.deps)).rejects.toThrow(
      `no token for ${PROJECT} at ${tokenPath}`,
    );
  });
});
