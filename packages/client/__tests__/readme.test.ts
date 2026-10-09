import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateDecision } from "@hexagen-monaco/waves-contract";

import { completeDecision } from "../src/domain/decision-document.js";
import { raise } from "../src/application/raise.js";
import type { Command } from "../src/domain/args.js";
import {
  CONFIG_DIR,
  NOW,
  PROJECT,
  PROJECT_TOKEN,
  harness,
} from "./support/harness.js";

type RaiseCommand = Extract<
  Command,
  { readonly kind: "decision"; readonly action: "raise" }
>;

const README = resolve(dirname(fileURLToPath(import.meta.url)), "../README.md");
const tokenPath = `${CONFIG_DIR}/${PROJECT}.token`;

// The three smallest valid documents, one per shape. These are the fenced JSON
// blocks in the README: the test loads them from the README and validates them,
// so the README cannot drift from what the client actually accepts.
const JSON_BLOCKS = /```json\n([\s\S]*?)\n```/g;

function extractJsonBlocks(markdown: string): unknown[] {
  const blocks: unknown[] = [];
  let match: RegExpExecArray | null;
  while ((match = JSON_BLOCKS.exec(markdown)) !== null) {
    const text = match[1];
    if (text !== undefined) {
      blocks.push(JSON.parse(text.trim()));
    }
  }
  return blocks;
}

function isDecision(b: unknown): b is Record<string, unknown> {
  return (
    typeof b === "object" &&
    b !== null &&
    typeof (b as Record<string, unknown>).id === "string" &&
    typeof (b as Record<string, unknown>).question === "string"
  );
}

function command(source = { kind: "stdin" as const }): RaiseCommand {
  return { kind: "decision", action: "raise", source };
}

function harnessFor(input = {}) {
  return harness({
    files: { [tokenPath]: { text: PROJECT_TOKEN, mode: 0o600 } },
    ...input,
  });
}

describe("README documents validate after completion", () => {
  it("parses every fenced JSON block, completes and validates them", () => {
    const readme = readFileSync(README, "utf-8");
    const blocks = extractJsonBlocks(readme);
    // There are three decision documents in the README.
    const decisions = blocks.filter(isDecision);
    expect(decisions).toHaveLength(3);

    for (const doc of decisions) {
      const completed = completeDecision(doc, {
        project: PROJECT,
        now: NOW,
      });
      expect(completed.ok).toBe(true);
      if (completed.ok) {
        expect(validateDecision(completed.document).ok).toBe(true);
      }
    }
  });

  it("has one choice, one action and one instruction", () => {
    const readme = readFileSync(README, "utf-8");
    const decisions = extractJsonBlocks(readme).filter(isDecision);
    const shapes = decisions.map((d) => d.shape ?? "choice").sort();
    expect(shapes).toEqual(["action", "choice", "instruction"]);
  });
});

describe("README refusal equals what the client prints", () => {
  it("produces the refusal stderr the README shows", async () => {
    const readme = readFileSync(README, "utf-8");

    // A choice with one option and hardToUndo.value: true with no reason.
    const refusal = JSON.stringify({
      id: "d1",
      question: "What should we do?",
      shape: "choice",
      options: [{ key: "a", text: "A", cost: "C1" }],
      hardToUndo: { value: true },
      decider: "owner",
      raisedBy: "session",
    });

    const built = harnessFor({ stdin: refusal });
    const exitCode = await raise(command(), built.deps);

    expect(exitCode).toBe(2);
    expect(built.sent()).toBe(0);

    // The README must contain exactly these lines.
    expect(readme).toContain(
      "waves decision raise: /hardToUndo/reason: expected a reason",
    );
    expect(readme).toContain(
      "waves decision raise: /options: expected at least 2 options for a choice",
    );
    expect(readme).toContain(
      "waves decision raise: not raised; fix the document, or ask in the terminal",
    );
    expect(readme).toContain("Exit 2, nothing sent.");
  });
});
