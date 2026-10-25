/*
 * The pure half of Machine addressing: whether a host path lies inside a
 * registered root, and how a root prefix in text becomes a Machine locator.
 * Kept out of `git.ts` so the boundary cases are unit-testable: a root that is
 * a text prefix of a sibling directory, and the root `/`, whose own text ends
 * where the next path begins.
 */

/**
 * Whether `target` is one of `roots` or lies below one. Roots bound addressing
 * only: this is not a security boundary.
 */
export function isInsideRoots(
  roots: ReadonlyArray<string>,
  target: string,
): boolean {
  return roots.some(
    (root) =>
      target === root || target.startsWith(root === "/" ? "/" : `${root}/`),
  );
}

/**
 * One registered root as a matcher. The character before the root must not
 * continue a path, so `/srv/app` never rewrites inside `/srv/application`, and
 * the character after it must end the path or open a separator, a quote, or a
 * delimiter, so `/srv/app+1` is not rewritten as `/srv/app` plus `+1`.
 */
function rootPattern(root: string): RegExp {
  if (root === "/") {
    // The root's own text is the leading separator itself, so it needs no
    // lookahead: every absolute path starts with it.
    return /(?<![\w./-])\/(?=[^\s'"])/gu;
  }
  const escaped = root.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
  return new RegExp(`(?<![\\w.\\/-])${escaped}(?=/|$|['"\\s:,)\\]])`, "gu");
}

/**
 * Rewrite each registered-root prefix of `text` to the locator form. The
 * longest root goes first, so `/home/me/work` wins over `/home/me`.
 */
export function rewriteRootPrefixes(
  text: string,
  roots: ReadonlyArray<string>,
  displayPrefix: string,
): string {
  return [...roots]
    .sort((left, right) => right.length - left.length)
    .reduce(
      (current, root) =>
        current.replaceAll(rootPattern(root), `${displayPrefix}${root}`),
      text,
    );
}
