import { describe, expect, it } from "vitest";

import {
  issueLines,
  readIssues,
  readReceivedAt,
  readToken,
  reasonPhrase,
  serverFailure,
} from "../src/domain/reply.js";

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

  it("reads a single message when the server sent one", () => {
    expect(readIssues('{"message":"admin registration is disabled"}')).toEqual([
      { path: "", message: "admin registration is disabled" },
    ]);
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

  it("reads a receivedAt, and refuses anything that is not one", () => {
    expect(readReceivedAt('{"receivedAt":"2026-02-03T04:05:07.000Z"}')).toBe(
      "2026-02-03T04:05:07.000Z",
    );
    expect(readReceivedAt("{}")).toBeUndefined();
    expect(readReceivedAt("not json")).toBeUndefined();
    expect(readReceivedAt("7")).toBeUndefined();
  });
});
