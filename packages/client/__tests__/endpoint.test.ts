import { describe, expect, it } from "vitest";

import {
  insecureWarning,
  isHostName,
  isHttpsUrl,
  isLoopback,
  projectsPath,
  readEndpoint,
  wavePath,
} from "../src/domain/endpoint.js";

function endpointOf(raw: string, allowInsecureHttp = false) {
  const parsed = readEndpoint(raw, allowInsecureHttp);
  if (!parsed.ok) {
    throw new Error(`expected ${raw} to be an endpoint`);
  }
  return parsed.endpoint;
}

function errorOf(raw: string, allowInsecureHttp = false): string {
  const parsed = readEndpoint(raw, allowInsecureHttp);
  if (parsed.ok) {
    throw new Error(`expected ${raw} to be refused`);
  }
  return parsed.error;
}

describe("readEndpoint", () => {
  it("keeps an https origin and its port", () => {
    expect(endpointOf("https://waves.example.com")).toEqual({
      origin: "https://waves.example.com",
      secure: true,
      warnInsecure: false,
    });
    expect(endpointOf("https://waves.example.com:8443/").origin).toBe(
      "https://waves.example.com:8443",
    );
  });

  it("refuses an empty, relative or foreign URL", () => {
    expect(errorOf("")).toBe("must not be empty");
    expect(errorOf("   ")).toBe("must not be empty");
    expect(errorOf("waves.example.com")).toBe("must be an absolute URL");
    expect(errorOf("ftp://waves.example.com")).toBe("must use http: or https:");
  });

  it("refuses a URL that carries more than an origin", () => {
    expect(errorOf("https://user:pw@waves.example.com")).toBe(
      "must not carry credentials",
    );
    expect(errorOf("https://waves.example.com/api")).toBe(
      "must be an origin without a path",
    );
    expect(errorOf("https://waves.example.com?a=1")).toBe(
      "must not carry a query or a fragment",
    );
    expect(errorOf("https://waves.example.com#top")).toBe(
      "must not carry a query or a fragment",
    );
  });

  it("refuses a host no name could have", () => {
    expect(errorOf("https://waves_example.com")).toBe("must have a valid host");
  });

  it("allows plain http to a loopback host without any override", () => {
    expect(endpointOf("http://localhost:8080")).toEqual({
      origin: "http://localhost:8080",
      secure: false,
      warnInsecure: false,
    });
    expect(endpointOf("http://127.0.0.5:8080").origin).toBe(
      "http://127.0.0.5:8080",
    );
    expect(endpointOf("http://[::1]:8080").origin).toBe("http://[::1]:8080");
  });

  it("refuses plain http anywhere else unless the override is set", () => {
    expect(errorOf("http://waves.example.com")).toBe(
      "must use https:, or http: on a loopback host, or WAVES_ALLOW_INSECURE_HTTP=1",
    );
    expect(endpointOf("http://waves.example.com", true).origin).toBe(
      "http://waves.example.com",
    );
  });

  it("warns on every request to an insecurely allowed host", () => {
    expect(endpointOf("http://10.0.0.4:8080", true)).toEqual({
      origin: "http://10.0.0.4:8080",
      secure: false,
      warnInsecure: true,
    });
    expect(endpointOf("http://10.0.0.4:8080", true).warnInsecure).toBe(true);
  });
});

describe("hosts", () => {
  it("takes dot-separated slugs and IP literals", () => {
    expect(isHostName("waves.example.com")).toBe(true);
    expect(isHostName("127.0.0.1")).toBe(true);
    expect(isHostName("[::1]")).toBe(true);
    expect(isHostName("[not:an:address]")).toBe(false);
    expect(isHostName("-waves")).toBe(false);
  });

  it("names localhost, 127.0.0.0/8 and ::1 as loopback", () => {
    expect(isLoopback("localhost")).toBe(true);
    expect(isLoopback("127.0.0.1")).toBe(true);
    expect(isLoopback("127.255.255.255")).toBe(true);
    expect(isLoopback("[::1]")).toBe(true);
    expect(isLoopback("::1")).toBe(true);
    expect(isLoopback("128.0.0.1")).toBe(false);
    expect(isLoopback("127.0.0.256")).toBe(false);
    expect(isLoopback("waves.example.com")).toBe(false);
  });

  it("takes an absolute https URL with no credentials", () => {
    expect(isHttpsUrl("https://github.com/example/waves.git")).toBe(true);
    expect(isHttpsUrl("http://github.com/example")).toBe(false);
    expect(isHttpsUrl("https://user@github.com/")).toBe(false);
    expect(isHttpsUrl("not a url")).toBe(false);
  });
});

describe("paths", () => {
  it("builds the collection and the wave paths", () => {
    expect(projectsPath(false)).toBe("/api/v1/projects");
    expect(projectsPath(true)).toBe("/api/v1/projects?rotate=1");
    expect(wavePath("waves-demo", "wv5")).toBe(
      "/api/v1/projects/waves-demo/waves/wv5",
    );
  });

  it("names an insecure origin once, for every request", () => {
    expect(insecureWarning("http://10.0.0.4:8080")).toBe(
      "waves: http://10.0.0.4:8080 is plain http, so the token travels in clear text",
    );
  });
});
