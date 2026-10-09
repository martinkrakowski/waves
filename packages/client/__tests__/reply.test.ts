import { describe, expect, it } from "vitest";

import {
  MAX_SERVER_TEXT,
  labelIssueLines,
  issueLines,
  readIssues,
  readRaiseReply,
  readReceivedAt,
  readServerError,
  readStateEntryIndex,
  readStaleReply,
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

  it("turns the characters that render as nothing into spaces", () => {
    const bidi = [
      "\u202e",
      "\u2066",
      "\u2067",
      "\u2068",
      "\u2069",
      "\u200b",
      "\ufeff",
      "\u00ad",
    ];
    for (const point of bidi) {
      expect(safeText(`refused${point}more`)).toBe("refused more");
    }
  });

  it("turns the two Unicode line separators into spaces", () => {
    expect(safeText("a\u2028b\u2029c")).toBe("a b c");
  });

  it("keeps the text around a bidi control, in the order it was written", () => {
    // A right-to-left override is how a message is made to read backwards.
    expect(safeText("gnp.exe\u202egnpl.soh")).toBe("gnp.exe gnpl.soh");
  });

  it("caps what a server can make a terminal print, by character", () => {
    const long = safeText("x".repeat(500));
    expect(long).toHaveLength(MAX_SERVER_TEXT);
    expect(long.endsWith("…")).toBe(true);
  });

  it("never cuts a character made of two code units in half", () => {
    const boundary = "x".repeat(MAX_SERVER_TEXT - 2) + "\u{1f600}" + "tail";
    const capped = safeText(boundary);
    // 198 characters, the emoji whole, and the ellipsis: 200 characters, though
    // 201 code units.
    expect(capped).toBe(`${"x".repeat(MAX_SERVER_TEXT - 2)}\u{1f600}…`);
    expect(Array.from(capped)).toHaveLength(MAX_SERVER_TEXT);
    expect(capped.includes("\u{1f600}")).toBe(true);
  });

  it("counts characters when it caps, not code units", () => {
    // 150 emoji are 300 code units but only 150 characters, so they fit.
    const fitting = "\u{1f600}".repeat(150);
    expect(Array.from(fitting)).toHaveLength(150);
    expect(safeText(fitting)).toBe(fitting);

    const capped = safeText("\u{1f600}".repeat(300));
    expect(Array.from(capped)).toHaveLength(MAX_SERVER_TEXT);
    expect(capped).toBe(`${"\u{1f600}".repeat(MAX_SERVER_TEXT - 1)}…`);
    expect(capped.includes("\u{fffd}")).toBe(false);
  });

  it("sanitises an answer made of nothing but escapes in time to print it", () => {
    // Every pair here opens a sequence that ends at the next bracket, so the
    // scan is short; what must not happen is a copy of the rest of the answer
    // for each of them.
    const escapes = "\u001b[".repeat(32 * 1024);
    const started = performance.now();
    const sanitised = safeText(escapes);
    const elapsed = performance.now() - started;

    expect(sanitised).toBe("");
    expect(Buffer.byteLength(escapes)).toBe(64 * 1024);
    expect(elapsed).toBeLessThan(50);
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

describe("readRaiseReply", () => {
  it("reads a valid raise reply", () => {
    expect(
      readRaiseReply(
        '{"revision":1,"textSha256":"abc","created":true,"entries":0}',
      ),
    ).toEqual({ revision: 1, textSha256: "abc", created: true, entries: 0 });
  });

  it("refuses a body with the wrong field types", () => {
    expect(
      readRaiseReply(
        '{"revision":"x","textSha256":"abc","created":true,"entries":0}',
      ),
    ).toBeUndefined();
    expect(
      readRaiseReply(
        '{"revision":1,"textSha256":"abc","created":"yes","entries":0}',
      ),
    ).toBeUndefined();
    expect(
      readRaiseReply(
        '{"revision":1,"textSha256":"abc","created":true,"entries":"x"}',
      ),
    ).toBeUndefined();
    expect(
      readRaiseReply(
        '{"revision":1.5,"textSha256":"abc","created":true,"entries":0}',
      ),
    ).toBeUndefined();
  });

  it("refuses a body that is not an object or that is missing fields", () => {
    expect(readRaiseReply("not json")).toBeUndefined();
    expect(readRaiseReply("[1,2]")).toBeUndefined();
    expect(readRaiseReply('{"revision":1}')).toBeUndefined();
  });
});

describe("readServerError", () => {
  it("reads the error the server sends on a 409", () => {
    expect(readServerError('{"error":"too many decisions"}')).toBe(
      "too many decisions",
    );
  });

  it("returns nothing when the body carried no error", () => {
    expect(readServerError("{}")).toBe("");
    expect(readServerError("not json")).toBe("");
  });
});

describe("labelIssueLines", () => {
  it("prefixes each issue with the label and the JSON pointer", () => {
    expect(
      labelIssueLines("waves decision raise", [
        { path: "/schema", message: "expected waves-notice/v1" },
        { path: "", message: "root problem" },
      ]),
    ).toEqual([
      "waves decision raise: /schema: expected waves-notice/v1",
      "waves decision raise: /: root problem",
    ]);
  });
});

describe("readStateEntryIndex", () => {
  it("reads the index a 201 answers with", () => {
    expect(readStateEntryIndex('{"index":3}')).toBe(3);
  });

  it("refuses anything that is not an integer index", () => {
    expect(readStateEntryIndex("not json")).toBeUndefined();
    expect(readStateEntryIndex("[1]")).toBeUndefined();
    expect(readStateEntryIndex("{}")).toBeUndefined();
    expect(readStateEntryIndex('{"index":"x"}')).toBeUndefined();
    expect(readStateEntryIndex('{"index":1.5}')).toBeUndefined();
  });
});

describe("readStaleReply", () => {
  it("reads the current revision, hash and entry count of a 409", () => {
    expect(
      readStaleReply('{"revision":2,"textSha256":"abc","entries":3}'),
    ).toEqual({ revision: 2, textSha256: "abc", entries: 3 });
  });

  it("refuses a body with the wrong field types", () => {
    expect(
      readStaleReply('{"revision":"x","textSha256":"abc","entries":3}'),
    ).toBeUndefined();
    expect(
      readStaleReply('{"revision":2,"textSha256":"abc","entries":"x"}'),
    ).toBeUndefined();
    expect(
      readStaleReply('{"revision":2.5,"textSha256":"abc","entries":3}'),
    ).toBeUndefined();
  });

  it("refuses a body that is not an object", () => {
    expect(readStaleReply("not json")).toBeUndefined();
    expect(readStaleReply("[1,2]")).toBeUndefined();
    expect(readStaleReply('{"revision":2}')).toBeUndefined();
  });
});
