const ALLOWED_TARBALL_ENTRIES = new Set([
  // The bare top-level `package` directory entry is a structural tar
  // artifact some archivers emit, not a payload leak.
  "package",
  "package/LICENSE",
  "package/README.md",
  "package/package.json",
]);
const ALLOWED_DIST_PREFIX = "package/dist/";
const ALLOWED_DIST_ROOT = "package/dist";

/**
 * An entry is canonical when every `/`-separated segment is a plain name —
 * never empty (rejects `package//x`), `.`, or `..`. A non-canonical entry
 * can pass a naive `startsWith("package/dist/")` prefix check while its
 * resolved path escapes `dist` entirely (e.g. `package/dist/../../AGENTS.md`),
 * so this must run before the allowlist, not as part of it.
 */
function hasCanonicalSegments(entryName) {
  return entryName
    .split("/")
    .every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/**
 * The published tarball must ship nothing but compiled output and the
 * minimum npm-required metadata. Every other entry — source, tests,
 * stories, build caches, temporary Storybook output, visual-test
 * candidate/diff images, or internal agent/design documents — is a leak.
 */
export function isAllowedTarballEntry(entryName) {
  if (!hasCanonicalSegments(entryName)) {
    return false;
  }
  return (
    ALLOWED_TARBALL_ENTRIES.has(entryName) ||
    entryName === ALLOWED_DIST_ROOT ||
    entryName.startsWith(ALLOWED_DIST_PREFIX)
  );
}

export function findDisallowedTarballEntries(entryNames) {
  return entryNames.filter((entryName) => !isAllowedTarballEntry(entryName));
}

const REQUIRED_TARBALL_ENTRIES = [
  "package/LICENSE",
  "package/README.md",
  "package/package.json",
];

/**
 * The allowlist bounds the tarball from above (nothing extra ships); this
 * bounds it from below (nothing required is missing). Without it, an
 * archive containing only `package/package.json` — or missing LICENSE
 * entirely — would pass the allowlist check.
 */
export function findMissingRequiredEntries(entryNames) {
  const entrySet = new Set(entryNames);
  const missing = REQUIRED_TARBALL_ENTRIES.filter(
    (requiredEntry) => !entrySet.has(requiredEntry),
  );
  const hasCompiledOutput = entryNames.some((entryName) =>
    entryName.startsWith(ALLOWED_DIST_PREFIX),
  );
  if (!hasCompiledOutput) {
    missing.push("package/dist/** (no compiled output present)");
  }
  return missing;
}

/**
 * Packed-archive size budget in bytes. Measured 2026-07-26: the clean
 * archive (dist + LICENSE + README.md + package.json, including
 * sourcemaps and declarations) packs to about 46 kB (pack output is not
 * byte-deterministic across runs — gzip embeds mtimes — so this is an
 * order-of-magnitude baseline, not an exact figure). 150 KiB keeps more
 * than 3x headroom for legitimate growth (new modules, a bundled icon,
 * longer docs). This is a backstop against bloat *within* the allowlist
 * (a stray binary asset in dist, a runaway sourcemap) — it is not the
 * leak detector: gzip can compress a leaked source/test tree back under
 * this budget, so the allowlist above is what actually rejects a leak.
 */
export const MAX_PACKED_ARCHIVE_SIZE_BYTES = 150 * 1024;
