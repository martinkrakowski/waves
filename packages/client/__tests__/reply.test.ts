import { describe, expect, it } from "vitest";

import {
  MAX_SERVER_TEXT,
  issueLines,
  readIssues,
  readReceivedAt,
  readToken,
  reasonPhrase,
  safeText,
  serverFailure,
} from "../src/domain/reply.js";

const ESCAPE = String.fromCharCode(27);
const CLEAR = `${ESCAPE}[2J${ESCAPE}[H`;

describe("readIssues", () => {
  it("reads the pointers of a 422", () => {
    expect(
      readIssues(
        '{"errors":[{"path":"/lanes/0/id","message":"expected a lane id"},{"path":"","message":"too many lanes"}]}',
      ),
    ).toEqual([
      { path: "/lanes/0/id", message: "expected a lane id" },
      { path: "", message: "too many lanes" },
    ]);
  });

  it("reads the {error} the server sends for everything else", () => {
    expect(readIssues('{"error":"admin registration is disabled"}')).toEqual([
      { path: "", message: "admin registration is disabled" },
    ]);
  });

  it("still reads a {message}", () => {
    expect(readIssues('{"message":"the admin token was refused"}')).toEqual([
      { path: "", message: "the admin token was refused" },
    ]);
  });

  it("prefers pointers to a single message", () => {
    expect(
      readIssues(
        '{"error":"refused","errors":[{"path":"/wave","message":"bad"}]}',
      ),
    ).toEqual([{ path: "/wave", message: "bad" }]);
  });

  it("keeps only the pointers that are pointers", () => {
    expect(
      readIssues(
        '{"errors":[{"message":"no path"},{"path":"/x"},"nope",{"path":7,"message":7}]}',
      ),
    ).toEqual([{ path: "", message: "no path" }]);
  });

  it("has nothing to say about an empty or unparsable body", () => {
    expect(readIssues("")).toEqual([]);
    expect(readIssues("not json")).toEqual([]);
    expect(readIssues("[1,2]")).toEqual([]);
    expect(readIssues("{}")).toEqual([]);
  });
});

describe("safeText", () => {
  it("leaves ordinary text alone", () => {
    expect(safeText("the admin token was refused")).toBe(
      "the admin token was refused",
    );
  });

  it("removes an escape sequence and the line it would have drawn", () => {
    expect(safeText(`${CLEAR}the project is registered`)).toBe(
      "the project is registered",
    );
  });

  it("removes a lone escape, and an unfinished sequence", () => {
    expect(safeText(`before${ESCAPE}after`)).toBe("beforeafter");
    expect(safeText(`before${ESCAPE}[38;5after`)).toBe("beforefter");
    // An unfinished sequence has no end to find, so nothing after it is trusted.
    expect(safeText(`before${ESCAPE}[38;5`)).toBe("before");
  });

  it("turns a control into a space rather than letting it through", () => {
    const nul = String.fromCharCode(0);
    expect(safeText(`refused${nul}more`)).toBe("refused more");
    expect(safeText("a\nb")).toBe("a b");
    expect(safeText(`a${String.fromCharCode(133)}b`)).toBe("a b");
  });

  it("caps what a server can make a terminal print", () => {
    const long = safeText("x".repeat(500));
    expect(long).toHaveLength(MAX_SERVER_TEXT);
    expect(long.endsWith("…")).toBe(true);
  });

  it("makes every printed part of an answer safe", () => {
    expect(serverFailure(JSON.stringify({ error: `${CLEAR}nope` }))).toBe(
      "\n  nope",
    );
    expect(
      serverFailure(
        JSON.stringify({
          errors: [{ path: `${CLEAR}/a`, message: `x${CLEAR}` }],
        }),
      ),
    ).toBe("\n  /a: x");
  });
});

describe("issueLines", () => {
  it("names the pointer, or the whole envelope when there is none", () => {
    expect(
      issueLines([
        { path: "/lanes/0/id", message: "expected a lane id" },
        { path: "", message: "too many lanes" },
      ]),
    ).toEqual(["  /lanes/0/id: expected a lane id", "  too many lanes"]);
  });
});

describe("serverFailure", () => {
  it("appends the pointers, or nothing at all", () => {
    expect(serverFailure('{"errors":[{"path":"/wave","message":"bad"}]}')).toBe(
      "\n  /wave: bad",
    );
    expect(serverFailure('{"error":"slow down"}')).toBe("\n  slow down");
    expect(serverFailure("")).toBe("");
  });
});

describe("reasonPhrase", () => {
  it("names the status the way an HTTP trace would", () => {
    expect(reasonPhrase(201)).toBe("Unexpected Status");
    expect(reasonPhrase(422)).toBe("Unprocessable Content");
    expect(reasonPhrase(429)).toBe("Too Many Requests");
    expect(reasonPhrase(413)).toBe("Content Too Large");
  });
});

describe("the body of a success", () => {
  it("reads a token, and refuses anything that is not one", () => {
    expect(readToken('{"id":"waves-demo","token":"t0ken"}')).toBe("t0ken");
    expect(readToken('{"id":"waves-demo"}')).toBeUndefined();
    expect(readToken('{"token":""}')).toBeUndefined();
    expect(readToken('{"token":7}')).toBeUndefined();
    expect(readToken("not json")).toBeUndefined();
    expect(readToken("[]")).toBeUndefined();
  });

  it("writes a token down exactly as it arrived", () => {
    const token = `one${ESCAPE}[2Jtwo`;
    expect(readToken(JSON.stringify({ token }))).toBe(token);
  });

  it("reads a receivedAt, and refuses anything that is not one", () => {
    expect(readReceivedAt('{"receivedAt":"2026-02-03T04:05:07.000Z"}')).toBe(
      "2026-02-03T04:05:07.000Z",
    );
    expect(readReceivedAt("{}")).toBeUndefined();
    expect(readReceivedAt("not json")).toBeUndefined();
    expect(readReceivedAt("7")).toBeUndefined();
  });

  it("makes a receivedAt safe to print", () => {
    expect(readReceivedAt(JSON.stringify({ receivedAt: `${CLEAR}2026` }))).toBe(
      "2026",
    );
  });
});
