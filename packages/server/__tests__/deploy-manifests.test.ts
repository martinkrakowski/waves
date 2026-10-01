import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The overlay's Traefik objects are checked here without a cluster, because the
 * one mistake that matters is invisible until the ingress is applied: a router
 * whose middleware does not resolve is put in error and then served on neither
 * entrypoint, which takes the site down.
 *
 * These files are read with a small reader rather than a YAML library, because
 * the repository declares none and this is a flat `key: value` shape with one
 * nested block. Anything it does not understand stops it, so a manifest that
 * changes shape fails here rather than passing unread.
 */

const DEPLOY = fileURLToPath(new URL("../../../deploy/", import.meta.url));
const MIDNIGHT = `${DEPLOY}k8s/overlays/midnight/`;

interface Manifest {
  readonly body: string;
}

function read(...parts: string[]): Manifest {
  return { body: readFileSync(`${MIDNIGHT}${parts.join("/")}`, "utf8") };
}

/** The `key: value` pairs directly under a `metadata:` block. */
function metadataOf(manifest: Manifest): Readonly<Record<string, string>> {
  const lines = manifest.body.split("\n");
  const start = lines.indexOf("metadata:");
  expect(start, "the manifest has a metadata block").toBeGreaterThanOrEqual(0);
  const fields: Record<string, string> = {};
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") {
      continue;
    }
    if (!/^ {2}\S/.test(line)) {
      break;
    }
    const field = /^ {2}([A-Za-z0-9_.-]+):(?:[ ]?(.*))?$/.exec(line);
    if (field !== null && field[1] !== undefined) {
      fields[field[1]] = (field[2] ?? "").trim();
    }
  }
  return fields;
}

/** Every inline `patch: |-` block, as the JSON it carries. */
function patchesOf(manifest: Manifest): readonly unknown[] {
  const blocks = manifest.body.matchAll(/patch: \|-\n((?: {6}.*\n)+)/g);
  return [...blocks].map((block) =>
    JSON.parse(
      (block[1] ?? "")
        .split("\n")
        .map((line) => line.replace(/^ {6}/, ""))
        .join("\n"),
    ),
  );
}

const MIDDLEWARES_ANNOTATION =
  "traefik.ingress.kubernetes.io/router.middlewares";

describe("the midnight overlay", () => {
  const middleware = read("middleware.yaml");
  const kustomization = read("kustomization.yaml");

  it("names the middleware so that the ingress reference resolves to it", () => {
    const metadata = metadataOf(middleware);
    const references = [
      ...kustomization.body.matchAll(
        new RegExp(
          `"${MIDDLEWARES_ANNOTATION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}": "([^"]+)"`,
          "g",
        ),
      ),
    ].map((match) => match[1]);

    expect(references).toHaveLength(1);
    const reference = String(references[0]);
    const [qualified, provider] = reference.split("@");

    // Traefik's kubernetescrd provider reads a reference as
    // `<namespace>-<name>@kubernetescrd`, so this is the whole check: the
    // reference has to be the namespace and the name of the resource that
    // exists, in that order, or the router is put in error.
    expect(provider).toBe("kubernetescrd");
    expect(qualified).toBe(
      `${String(metadata.namespace)}-${String(metadata.name)}`,
    );
  });

  it("states the middleware's namespace, because nothing else sets it", () => {
    expect(metadataOf(middleware).namespace).toBe("waves");
    expect(kustomization.body).not.toContain("namePrefix");
    expect(kustomization.body).not.toContain("nameSuffix");
    expect(kustomization.body).toContain("- middleware.yaml");
  });

  it("adds one annotations map to the ingress, with the issuer and the middleware", () => {
    const patches = patchesOf(kustomization);
    const ingress = patches.find((patch) =>
      JSON.stringify(patch).includes("/spec/ingressClassName"),
    );

    expect(ingress).toBeDefined();
    const adds = (
      ingress as { op: string; path: string; value?: unknown }[]
    ).filter(
      (operation) =>
        operation.op === "add" && operation.path === "/metadata/annotations",
    );
    expect(adds).toHaveLength(1);
    const annotations = (adds[0]?.value ?? {}) as Record<string, string>;
    expect(annotations["cert-manager.io/cluster-issuer"]).toBe("midnight-ca");
    expect(annotations[MIDDLEWARES_ANNOTATION]).toBeDefined();
    expect(
      (kustomization.body.match(/"path": "\/metadata\/annotations"/g) ?? [])
        .length,
    ).toBe(1);
  });

  it("tells the service it is behind that proxy", () => {
    const patches = patchesOf(kustomization);
    const deployment = patches.find((patch) =>
      JSON.stringify(patch).includes("WAVES_TRUST_PROXY"),
    );

    expect(deployment).toBeDefined();
    const added = (
      deployment as {
        op: string;
        path: string;
        value?: { name?: string; value?: string };
      }[]
    )
      .filter((operation) => operation.op === "add")
      .map((operation) => operation.value ?? {});
    expect(added).toContainEqual({ name: "WAVES_TRUST_PROXY", value: "1" });
  });
});
