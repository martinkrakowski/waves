import { describe, expect, it } from "vitest";

import type { Project } from "@hexagen-monaco/waves-contract";

import {
  createRegistrationGate,
  registrationOf,
  sameRegistration,
} from "../src/application/registration-gate.js";

const PROJECT: Project = {
  id: "alpha",
  name: "Alpha",
  tokenSha256: "a".repeat(64),
  registeredAt: "2026-10-01T12:00:00Z",
};

describe("sameRegistration", () => {
  it("is false when the project is gone", () => {
    expect(sameRegistration(undefined, registrationOf(PROJECT))).toBe(false);
  });

  it("is true for the registration that authenticated", () => {
    expect(sameRegistration(PROJECT, registrationOf(PROJECT))).toBe(true);
  });

  it("is false when the token digest is another registration's", () => {
    expect(
      sameRegistration(
        { ...PROJECT, tokenSha256: "b".repeat(64) },
        registrationOf(PROJECT),
      ),
    ).toBe(false);
  });

  it("is false when the registration date is another registration's", () => {
    expect(
      sameRegistration(
        { ...PROJECT, registeredAt: "2026-10-02T00:00:00Z" },
        registrationOf(PROJECT),
      ),
    ).toBe(false);
  });
});

describe("registrationOf", () => {
  it("returns exactly the two stored fields, not id or name", () => {
    expect(registrationOf(PROJECT)).toEqual({
      tokenSha256: "a".repeat(64),
      registeredAt: "2026-10-01T12:00:00Z",
    });
  });
});

describe("createRegistrationGate", () => {
  it("runs operations in order and never beside another", async () => {
    const gate = createRegistrationGate();
    const order: string[] = [];
    let releaseA: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      releaseA = resolve;
    });

    const a = gate.exclusive(async () => {
      order.push("a-start");
      await pending;
      order.push("a-end");
      return "a";
    });
    const b = gate.exclusive(async () => {
      order.push("b-start");
      return "b";
    });

    await Promise.resolve();
    expect(order).toEqual(["a-start"]);

    releaseA();
    await expect(a).resolves.toBe("a");
    await expect(b).resolves.toBe("b");
    expect(order).toEqual(["a-start", "a-end", "b-start"]);
  });

  it("hands a rejection to its caller and still runs the next operation", async () => {
    const gate = createRegistrationGate();
    const failure = new Error("boom");
    const a = gate.exclusive(async () => {
      throw failure;
    });
    const b = gate.exclusive(async () => "b");

    await expect(a).rejects.toBe(failure);
    await expect(b).resolves.toBe("b");
  });
});
