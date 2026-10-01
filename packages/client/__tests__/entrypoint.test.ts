import { describe, expect, it } from "vitest";

import { main, type CliIo } from "../src/index.js";

function recordingIo(): { io: CliIo; lines: string[] } {
  const lines: string[] = [];
  const io: CliIo = {
    err: (line) => {
      lines.push(line);
    },
  };
  return { io, lines };
}

describe("main", () => {
  it("reports that it is not implemented and exits 2 without a command", () => {
    const { io, lines } = recordingIo();

    expect(main([], io)).toBe(2);
    expect(lines).toEqual(["waves: not implemented yet"]);
  });

  it("names the requested command and still exits 2", () => {
    const { io, lines } = recordingIo();

    expect(main(["publish"], io)).toBe(2);
    expect(lines).toEqual(["waves publish: not implemented yet"]);
  });
});
