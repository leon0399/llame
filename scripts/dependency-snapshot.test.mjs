import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { addSpdxDocument, buildSnapshot } from "./dependency-snapshot.mjs";

const registry = (name, version) => ({
  SPDXID: `SPDXRef-Package-${name}-${version}`,
  name,
  versionInfo: version,
  downloadLocation: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,
  externalRefs: [
    {
      referenceCategory: "PACKAGE-MANAGER",
      referenceType: "purl",
      referenceLocator: `pkg:npm/${name}@${version}`,
    },
  ],
});

const workspace = (name, version) => ({
  ...registry(name, version),
  downloadLocation: "NOASSERTION",
});

const dependsOn = (from, to) => ({
  spdxElementId: from,
  relatedSpdxElement: to,
  relationshipType: "DEPENDS_ON",
});

// apps/api depends on `next` and on the workspace package `machine`, whose
// own dependency `undici` reaches the api only through it.
const apiProd = {
  name: "api",
  packages: [
    { ...workspace("api", "0.0.1"), SPDXID: "SPDXRef-RootPackage" },
    registry("next", "16.3.8"),
    registry("react", "19.2.7"),
    workspace("machine", "0.0.1"),
    registry("undici", "7.29.1"),
  ],
  relationships: [
    {
      ...dependsOn("SPDXRef-DOCUMENT", "SPDXRef-RootPackage"),
      relationshipType: "DESCRIBES",
    },
    dependsOn("SPDXRef-RootPackage", "SPDXRef-Package-next-16.3.8"),
    dependsOn("SPDXRef-Package-next-16.3.8", "SPDXRef-Package-react-19.2.7"),
    dependsOn("SPDXRef-RootPackage", "SPDXRef-Package-machine-0.0.1"),
    dependsOn("SPDXRef-Package-machine-0.0.1", "SPDXRef-Package-undici-7.29.1"),
  ],
};

const apiDev = {
  name: "api",
  packages: [
    { ...workspace("api", "0.0.1"), SPDXID: "SPDXRef-RootPackage" },
    registry("vitest", "4.1.11"),
    registry("react", "19.2.7"),
  ],
  relationships: [
    dependsOn("SPDXRef-RootPackage", "SPDXRef-Package-vitest-4.1.11"),
    dependsOn("SPDXRef-RootPackage", "SPDXRef-Package-react-19.2.7"),
  ],
};

test("workspace packages never reach the snapshot under their npm names", () => {
  const resolved = addSpdxDocument({}, apiProd, "runtime");

  assert.deepEqual(Object.keys(resolved).sort(), [
    "pkg:npm/next@16.3.8",
    "pkg:npm/react@19.2.7",
    "pkg:npm/undici@7.29.1",
  ]);
});

test("root edges make a package direct; everything else is indirect", () => {
  const resolved = addSpdxDocument({}, apiProd, "runtime");

  assert.equal(resolved["pkg:npm/next@16.3.8"].relationship, "direct");
  assert.equal(resolved["pkg:npm/react@19.2.7"].relationship, "indirect");
  // Reached only through a dropped workspace package.
  assert.equal(resolved["pkg:npm/undici@7.29.1"].relationship, "indirect");
  assert.deepEqual(resolved["pkg:npm/next@16.3.8"].dependencies, [
    "pkg:npm/react@19.2.7",
  ]);
});

test("a package in both scopes stays runtime and keeps the stronger relationship", () => {
  const resolved = addSpdxDocument(
    addSpdxDocument({}, apiProd, "runtime"),
    apiDev,
    "development",
  );

  assert.equal(resolved["pkg:npm/vitest@4.1.11"].scope, "development");
  assert.equal(resolved["pkg:npm/react@19.2.7"].scope, "runtime");
  assert.equal(resolved["pkg:npm/react@19.2.7"].relationship, "direct");

  const devFirst = addSpdxDocument(
    addSpdxDocument({}, apiDev, "development"),
    apiProd,
    "runtime",
  );
  assert.equal(devFirst["pkg:npm/react@19.2.7"].scope, "runtime");
});

test("each workspace package is one manifest at its package.json path", () => {
  const snapshot = buildSnapshot({
    documents: [
      { scope: "runtime", document: apiProd },
      { scope: "development", document: apiDev },
    ],
    manifestPaths: new Map([["api", "apps/api/package.json"]]),
    sha: "0123456789abcdef0123456789abcdef01234567",
    ref: "refs/heads/master",
    job: { correlator: "dependency-submission", id: "42" },
    pnpmVersion: "12.9.0",
    scanned: "2026-10-24T00:00:00.000Z",
  });

  assert.deepEqual(Object.keys(snapshot.manifests), ["apps/api/package.json"]);
  assert.deepEqual(snapshot.manifests["apps/api/package.json"].file, {
    source_location: "apps/api/package.json",
  });
  assert.equal(
    Object.keys(snapshot.manifests["apps/api/package.json"].resolved).length,
    4,
  );
  assert.equal(snapshot.sha, "0123456789abcdef0123456789abcdef01234567");
  assert.equal(snapshot.job.correlator, "dependency-submission");
});

test("an SBOM for an unknown workspace package fails instead of being dropped", () => {
  assert.throws(
    () =>
      buildSnapshot({
        documents: [{ scope: "runtime", document: apiProd }],
        manifestPaths: new Map(),
      }),
    /no workspace package named api/,
  );
});

// Lays out what the workflow hands the CLI: `pnpm list` output and one
// `pnpm sbom --split` directory per scope.
function writeCliInputs(dir) {
  mkdirSync(path.join(dir, "prod"));
  mkdirSync(path.join(dir, "dev"));
  writeFileSync(
    path.join(dir, "prod", "api.spdx.json"),
    JSON.stringify(apiProd),
  );
  writeFileSync(path.join(dir, "dev", "api.spdx.json"), JSON.stringify(apiDev));
  writeFileSync(
    path.join(dir, "importers.json"),
    JSON.stringify([{ name: "api", path: path.join(dir, "apps", "api") }]),
  );
}

const runCli = (args, options) =>
  execFileSync(
    process.execPath,
    [path.resolve("scripts/dependency-snapshot.mjs"), ...args],
    { stdio: "pipe", ...options },
  );

test("the CLI reads both SBOM directories and writes the snapshot", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "dependency-snapshot-"));
  try {
    writeCliInputs(dir);

    const snapshot = JSON.parse(
      runCli(["importers.json", "prod", "dev"], {
        cwd: dir,
        env: {
          ...process.env,
          GITHUB_SHA: "abc",
          GITHUB_REF: "refs/heads/master",
          GITHUB_JOB: "dependency-submission",
          GITHUB_RUN_ID: "7",
          PNPM_VERSION: "12.9.0",
        },
      }),
    );

    assert.deepEqual(Object.keys(snapshot.manifests), [
      "apps/api/package.json",
    ]);
    assert.deepEqual(snapshot.job, {
      correlator: "dependency-submission",
      id: "7",
    });
    assert.equal(snapshot.detector.version, "12.9.0");
    assert.equal(
      snapshot.manifests["apps/api/package.json"].resolved[
        "pkg:npm/vitest@4.1.11"
      ].scope,
      "development",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the CLI rejects missing arguments", () => {
  assert.throws(
    () => runCli([]),
    (error) => error.status === 2,
  );
});
