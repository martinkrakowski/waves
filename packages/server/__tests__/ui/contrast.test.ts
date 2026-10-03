import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The pairs a reader reads most, each on both grounds it can land on. Four-and-a-
 * half to one is WCAG AA for body text, and it is the floor this project has
 * held since the first console plan; a palette that reaches for a fainter grey
 * to look quieter fails here rather than in a reader's eyes.
 */
const FOREGROUNDS = ["--text", "--muted", "--faint"] as const;
const BACKGROUNDS = ["--bg", "--card"] as const;
const AA = 4.5;

/** Six-digit hex, and nothing else: `var()` and `rgb()` are not colours here. */
const HEX = /^#[0-9a-f]{6}$/;

/** The file itself, read as text: the palettes are data to this test, not a build. */
const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, "..", "..", "public", "tokens.css");

/** The two `:root` blocks, the plain one and the one inside the light media query. */
function palettes(): {
  dark: Map<string, string>;
  light: Map<string, string>;
} {
  const css = readFileSync(SOURCE, "utf8");
  // Comments are prose and carry semicolons, so they go before anything is split.
  const bare = css.replaceAll(/\/\*[\s\S]*?\*\//g, "");
  const blocks = [...bare.matchAll(/:root\s*\{([^}]*)\}/g)].map(
    (match) => match[1] ?? "",
  );
  expect(blocks).toHaveLength(2);
  return {
    dark: declarations(blocks[0] ?? "", "dark"),
    light: declarations(blocks[1] ?? "", "light"),
  };
}

function declarations(block: string, name: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const line of block.split(";")) {
    const match = /^\s*(--[a-z0-9-]+)\s*:\s*(.+?)\s*$/s.exec(line);
    if (match !== null) {
      found.set(match[1] ?? "", match[2] ?? "");
    }
  }
  expect(found.size, `${name} declares no custom properties`).toBeGreaterThan(
    0,
  );
  return found;
}

/** The WCAG relative luminance of an `#rrggbb` colour. */
function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** The WCAG contrast ratio of two colours, which is what a reader's eye gets. */
function contrast(here: string, there: string): number {
  const one = luminance(here);
  const other = luminance(there);
  return (Math.max(one, other) + 0.05) / (Math.min(one, other) + 0.05);
}

function hexOf(tokens: Map<string, string>, name: string): string {
  const value = tokens.get(name);
  expect(value, `${name} is not declared in this palette`).toBeDefined();
  const hex = value ?? "";
  expect(hex, `${name} must be a six-digit hex, and is ${hex}`).toMatch(HEX);
  return hex;
}

describe("the two palettes", () => {
  const { dark, light } = palettes();

  it("holds every declared pairing at 4.5:1 in the dark default", () => {
    for (const foreground of FOREGROUNDS) {
      for (const background of BACKGROUNDS) {
        const ratio = contrast(
          hexOf(dark, foreground),
          hexOf(dark, background),
        );
        expect(
          ratio,
          `${foreground} on ${background} in the dark palette`,
        ).toBeGreaterThanOrEqual(AA);
      }
    }
  });

  it("holds every declared pairing at 4.5:1 in the light scheme", () => {
    for (const foreground of FOREGROUNDS) {
      for (const background of BACKGROUNDS) {
        const ratio = contrast(
          hexOf(light, foreground),
          hexOf(light, background),
        );
        expect(
          ratio,
          `${foreground} on ${background} in the light palette`,
        ).toBeGreaterThanOrEqual(AA);
      }
    }
  });
});

describe("the names every other stylesheet already reads", () => {
  const { dark, light } = palettes();

  it("declares all of them in the default palette, so no sheet is left unstyled", () => {
    const names = [
      "--bg",
      "--bg-raise",
      "--bg-sink",
      "--line",
      "--line-strong",
      "--text",
      "--muted",
      "--faint",
      "--amber",
      "--red",
      "--teal",
      "--blue",
      "--violet",
      "--sans",
      "--mono",
    ];
    for (const name of names) {
      expect(dark.get(name), `${name} in the dark palette`).toBeDefined();
    }
  });

  it("gives the light palette a twin of every colour the dark one holds", () => {
    const colour =
      /^--(?:bg|card|line|text|muted|faint|cyan|emerald|amber|rose|violet|slate)/;
    const darkNames = [...dark.keys()].filter((name) => colour.test(name));
    expect(darkNames.length).toBeGreaterThan(0);
    for (const name of darkNames) {
      expect(light.get(name), `${name} has no light twin`).toBeDefined();
    }
  });

  it("points the three old hue names at the new ones", () => {
    expect(dark.get("--blue")).toBe("var(--cyan)");
    expect(dark.get("--teal")).toBe("var(--emerald)");
    expect(dark.get("--red")).toBe("var(--rose)");
    expect(light.get("--blue")).toBe("var(--cyan)");
    expect(light.get("--teal")).toBe("var(--emerald)");
    expect(light.get("--red")).toBe("var(--rose)");
  });

  it("holds the radii and the sheen once, where the frame reads them", () => {
    expect(dark.get("--radius-card")).toBe("18px");
    expect(dark.get("--radius")).toBe("12px");
    expect(dark.get("--card-sheen")).toContain("linear-gradient");
  });
});
