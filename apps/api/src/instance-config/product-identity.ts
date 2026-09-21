import { readFileSync } from 'node:fs';
import path from 'node:path';

import { InstanceConfigError } from '@workspace/config-interpolation';
import { isRecord, isString } from '@workspace/runtime-safety';

/**
 * llame's own product token. Every language-model request identifies itself
 * with `PRODUCT_NAME/<version>` so no provider sees a bare adapter or
 * HTTP-library name (design D6 of openspec/changes/opencode-go-provider).
 */
export const PRODUCT_NAME = 'llame';

/**
 * The one fact about llame a model client needs: the identity token it sends
 * as `User-Agent`. A reader-shaped seam beside `InstanceConfigReader` so the
 * model-client factory depends on the identity alone — and so the existing
 * `InstanceConfigReader` fakes stay unchanged.
 */
export interface ProductIdentityReader {
  readonly productUserAgent: string;
}

/**
 * The API package manifest, resolved relative to THIS module's own compiled
 * location (`__dirname`), never the runtime cwd: `nest-cli.json` sets
 * `sourceRoot: "src"`, so `dist/` mirrors `src/` and this file sits two
 * directories below the manifest under `nest build`, `nest start`, and Vitest
 * alike — the same relative layout either way, so no separate "dist mode"
 * branch. The manifest is therefore a deployment prerequisite beside `dist/`.
 */
const MANIFEST_PATH = path.resolve(__dirname, '..', '..', 'package.json');

/**
 * Test seam (anti-slop/no-module-mocking): tests that need to simulate a
 * missing, unreadable, malformed, or version-less manifest substitute this
 * instead of module-mocking `node:fs` or `node:path`. Production call sites
 * never pass it — the default reads the real file.
 */
type ManifestFileAccess = {
  readFile(filePath: string): string;
};

const DEFAULT_MANIFEST_FILE_ACCESS: ManifestFileAccess = {
  readFile: (filePath) => readFileSync(filePath, 'utf8'),
};

/**
 * The LOGICAL deployment requirement every failure below names, never the
 * resolved absolute path (D6, and the accepted review finding on PR #905):
 * a boot diagnostic must disclose no host layout, and the version has no
 * other source than the manifest, so both failures are one requirement.
 */
const MANIFEST_REQUIREMENT =
  "llame's version cannot be read: apps/api/package.json must be deployed beside dist/";

/**
 * Read `PRODUCT_NAME/<version>` from the API package manifest, once at boot
 * (the caller caches it in `InstanceConfigService`).
 *
 * A manifest that is missing, unreadable, or not valid JSON, and one that
 * declares no non-blank `version`, both fail as an `InstanceConfigError` —
 * never as a raw `ENOENT` and never as a silent fallback to a generic name or
 * a hardcoded version, either of which would misreport llame's identity
 * forever after.
 */
export function loadProductUserAgent(
  access: ManifestFileAccess = DEFAULT_MANIFEST_FILE_ACCESS,
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(access.readFile(MANIFEST_PATH));
  } catch {
    throw new InstanceConfigError(
      `${MANIFEST_REQUIREMENT} — this deployment's manifest is missing, unreadable, or not valid JSON.`,
    );
  }
  const version = isRecord(parsed) ? parsed.version : undefined;
  if (!isString(version) || version.trim().length === 0) {
    throw new InstanceConfigError(
      `${MANIFEST_REQUIREMENT} with a non-blank "version" — this deployment's manifest declares none.`,
    );
  }
  return `${PRODUCT_NAME}/${version}`;
}
