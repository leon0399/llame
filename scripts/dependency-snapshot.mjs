/**
 * Builds a GitHub dependency submission snapshot from `pnpm sbom` output, so
 * the dependency graph, Dependabot alerts and the Security tab see the
 * packages pnpm actually locks.
 *
 * GitHub's static parser reads only the first YAML document of pnpm 11+'s
 * `pnpm-lock.yaml` (the pnpm binaries) and records catalog dependencies as
 * `catalog:`, so its graph misses nearly every installed package. A submitted
 * manifest takes precedence over the statically detected one at the same
 * path, so each workspace package is submitted under its own `package.json`.
 *
 * Inputs are the per-package SPDX documents `pnpm sbom --split` writes, once
 * with `--prod` and once with `--dev`, and the importer list from
 * `pnpm list --recursive --depth -1 --json`. Workspace packages and the root
 * carry no registry download location; they are dropped, because their
 * `pkg:npm` URLs name unrelated public packages (`machine`, `storybook`).
 *
 * Usage: node scripts/dependency-snapshot.mjs <importers.json> <prod-dir> <dev-dir>
 * Reads GITHUB_SHA, GITHUB_REF, GITHUB_RUN_ID, GITHUB_JOB and PNPM_VERSION;
 * writes the snapshot JSON to stdout.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = "SPDXRef-RootPackage";

function purlOf(pkg) {
  return pkg.externalRefs?.find((ref) => ref.referenceType === "purl")
    ?.referenceLocator;
}

/**
 * Adds one SPDX document's packages to a manifest's `resolved` map. A package
 * seen under both scopes stays `runtime`, and one direct in either stays
 * `direct`.
 */
export function addSpdxDocument(resolved, document, scope) {
  const registryPurls = new Map(
    document.packages
      .filter((pkg) => pkg.downloadLocation !== "NOASSERTION")
      .map((pkg) => [pkg.SPDXID, purlOf(pkg)]),
  );
  const direct = new Set();
  const dependencies = new Map();
  for (const {
    spdxElementId,
    relatedSpdxElement,
    relationshipType,
  } of document.relationships) {
    if (relationshipType !== "DEPENDS_ON") continue;
    if (spdxElementId === ROOT) direct.add(relatedSpdxElement);
    const child = registryPurls.get(relatedSpdxElement);
    if (!child || !registryPurls.has(spdxElementId)) continue;
    if (!dependencies.has(spdxElementId))
      dependencies.set(spdxElementId, new Set());
    dependencies.get(spdxElementId).add(child);
  }
  for (const [id, purl] of registryPurls) {
    const entry = resolved[purl] ?? {
      package_url: purl,
      relationship: "indirect",
      scope,
      dependencies: [],
    };
    if (direct.has(id)) entry.relationship = "direct";
    if (scope === "runtime") entry.scope = "runtime";
    entry.dependencies = [
      ...new Set([...entry.dependencies, ...(dependencies.get(id) ?? [])]),
    ].sort();
    resolved[purl] = entry;
  }
  return resolved;
}

/**
 * Returns the snapshot body. `documents` holds `{ scope, document }` pairs;
 * `manifestPaths` maps each importer name to its `package.json` path relative
 * to the repository root.
 */
export function buildSnapshot({
  documents,
  manifestPaths,
  sha,
  ref,
  job,
  pnpmVersion,
  scanned,
}) {
  const manifests = {};
  for (const { scope, document } of documents) {
    const manifestPath = manifestPaths.get(document.name);
    if (!manifestPath) {
      throw new Error(`no workspace package named ${document.name}`);
    }
    manifests[manifestPath] ??= {
      name: manifestPath,
      file: { source_location: manifestPath },
      resolved: {},
    };
    addSpdxDocument(manifests[manifestPath].resolved, document, scope);
  }
  return {
    version: 0,
    sha,
    ref,
    job,
    detector: {
      name: "pnpm sbom",
      version: pnpmVersion,
      url: "https://pnpm.io/cli/sbom",
    },
    scanned,
    manifests,
  };
}

function readDocuments(directory, scope) {
  return readdirSync(directory)
    .filter((file) => file.endsWith(".json"))
    .map((file) => ({
      scope,
      document: JSON.parse(readFileSync(path.join(directory, file), "utf8")),
    }));
}

function main([importersPath, prodDir, devDir]) {
  if (!importersPath || !prodDir || !devDir) {
    console.error(
      "usage: node scripts/dependency-snapshot.mjs <importers.json> <prod-dir> <dev-dir>",
    );
    return 2;
  }
  const importers = JSON.parse(readFileSync(importersPath, "utf8"));
  const manifestPaths = new Map(
    importers.map(({ name, path: dir }) => [
      name,
      path.relative(process.cwd(), path.join(dir, "package.json")),
    ]),
  );
  const snapshot = buildSnapshot({
    documents: [
      ...readDocuments(prodDir, "runtime"),
      ...readDocuments(devDir, "development"),
    ],
    manifestPaths,
    sha: process.env.GITHUB_SHA,
    ref: process.env.GITHUB_REF,
    job: { correlator: process.env.GITHUB_JOB, id: process.env.GITHUB_RUN_ID },
    pnpmVersion: process.env.PNPM_VERSION,
    scanned: new Date().toISOString(),
  });
  process.stdout.write(JSON.stringify(snapshot));
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  process.exitCode = main(process.argv.slice(2));
}
