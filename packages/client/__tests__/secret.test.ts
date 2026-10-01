import { describe, expect, it } from "vitest";

import { isTightMode, modeText } from "../src/domain/secret.js";
import { TAIL_BYTES, truncateTail } from "../src/domain/tail.js";

describe("isTightMode", () => {
  it("takes 0600 and anything stricter", () => {
    expect(isTightMode(0o600)).toBe(true);
    expect(isTightMode(0o400)).toBe(true);
    expect(isTightMode(0o200)).toBe(true);
    expect(isTightMode(0o000)).toBe(true);
    expect(isTightMode(0o700)).toBe(false);
  });

  it("refuses anything group, other or the owner can reach", () => {
    expect(isTightMode(0o640)).toBe(false);
    expect(isTightMode(0o604)).toBe(false);
    expect(isTightMode(0o660)).toBe(false);
  });
});

describe("modeText", () => {
  it("prints three octal digits", () => {
    expect(modeText(0o600)).toBe("0o600");
    expect(modeText(0o644)).toBe("0o644");
    expect(modeText(0o040)).toBe("0o040");
  });
});

describe("truncateTail", () => {
  it("leaves a short tail exactly as it is", () => {
    expect(truncateTail("line one\nline two\n")).toBe("line one\nline two\n");
    expect(truncateTail("")).toBe("");
    expect(truncateTail("x".repeat(TAIL_BYTES))).toBe("x".repeat(TAIL_BYTES));
  });

  it("keeps the last 4096 bytes", () => {
    const tail = truncateTail("x".repeat(TAIL_BYTES + 100));
    expect(tail).toBe("x".repeat(TAIL_BYTES));
    expect(Buffer.byteLength(tail)).toBe(TAIL_BYTES);
  });

  it("does not split a code point that crosses the boundary", () => {
    // The cut lands one byte into the euro sign, so its two remaining bytes go.
    const text = `${"a".repeat(TAIL_BYTES)}€${"c".repeat(4094)}`;
    const tail = truncateTail(text);
    expect(tail).toBe("c".repeat(4094));
    expect(Buffer.byteLength(tail)).toBe(4094);
  });

  it("drops every continuation byte of a four byte character", () => {
    const text = `${"a".repeat(TAIL_BYTES)}😀${"c".repeat(4094)}`;
    expect(truncateTail(text)).toBe("c".repeat(4094));
  });

  it("keeps a code point that lands exactly on the boundary", () => {
    const text = `${"a".repeat(TAIL_BYTES - 3)}€${"c".repeat(4093)}`;
    const tail = truncateTail(text);
    expect(tail).toBe(`€${"c".repeat(4093)}`);
    expect(Buffer.byteLength(tail)).toBe(TAIL_BYTES);
  });
});
