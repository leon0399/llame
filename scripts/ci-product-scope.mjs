import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Only known documentation and harness instructions are exempt. In particular,
// Markdown under apps/api/src/prompts is runtime input, not documentation.
export function needsProductChecks(paths) {
  return paths.some(
    (file) =>
      !/^(?:docs|openspec|\.changeset|\.agents|\.claude|\.codex|\.opencode|\.omp)\//u.test(
        file,
      ) &&
      !/^[^/]+\.md$/u.test(file) &&
      !/^\.github\/[^/]+\.md$/u.test(file) &&
      !/(?:^|\/)(?:AGENTS|CLAUDE|GEMINI|README|CONTRIBUTING|CHANGELOG)\.md$/u.test(
        file,
      ),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const paths = readFileSync(0, "utf8").split("\0").filter(Boolean);
  process.stdout.write(`product=${needsProductChecks(paths)}\n`);
}
