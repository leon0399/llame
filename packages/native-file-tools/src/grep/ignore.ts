import ignore from "ignore";

/**
 * One ignore-file rule, compiled into the one-rule negation instance design D6
 * pins: `ignore` passes only the `ignored` verdict down from an ancestor, so a
 * negation instance reports a match on the tested path itself.
 */
export interface CompiledIgnoreRule {
  /** The verdict a match gives: true excludes the entry, false re-includes it. */
  readonly ignored: boolean;
  match(pathname: string): boolean;
}

/** One rule line, or undefined for a blank line or a comment. */
function ruleLine(line: string): string | undefined {
  const text = line.endsWith("\r") ? line.slice(0, -1) : line;
  if (text.length === 0 || text.startsWith("#")) return undefined;
  return text;
}

/**
 * Compile each rule of one ignore file, in file order. A rule is added to its
 * own one-rule instance as a negation, so `unignored` means the pattern matched
 * that path itself and not one of its ancestors. Comment lines are dropped
 * before the `!` is added: an ignore file's `#` line is a comment, while `!#`
 * would be a negation rule matching a file named `# …`.
 */
export function compileIgnoreRules(
  text: string,
): ReadonlyArray<CompiledIgnoreRule> {
  const rules: Array<CompiledIgnoreRule> = [];
  for (const line of text.split("\n")) {
    const rule = ruleLine(line);
    if (rule === undefined) continue;
    const negated = rule.startsWith("!");
    const manager = ignore({ ignorecase: false }).add(
      negated ? rule : `!${rule}`,
    );
    rules.push({
      ignored: !negated,
      match: (pathname) => manager.test(pathname).unignored,
    });
  }
  return rules;
}

/**
 * One layer's verdict for a path: its last rule whose pattern matches decides,
 * and a re-including rule (a negation) decides too. Undefined when no rule of
 * the layer matches, so a deeper layer's decision is the one that counts.
 */
export function decideIgnoreLayer(
  rules: ReadonlyArray<CompiledIgnoreRule>,
  pathname: string,
): boolean | undefined {
  let verdict: boolean | undefined;
  for (const rule of rules) {
    if (rule.match(pathname)) verdict = rule.ignored;
  }
  return verdict;
}
