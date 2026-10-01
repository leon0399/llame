import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  checkFile,
  extractLinks,
  headingAnchors,
  isIgnored,
  slugify,
} from "./check-markdown-links.mjs";

/** A checkout holding the given documents, written by repository path. */
function repository(t, files) {
  const root = mkdtempSync(path.join(tmpdir(), "markdown-links-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}

/** Every problem one document of that checkout has. */
const check = (root, file) => checkFile(path.join(root, file), { root });

const problem = (file, line, message) => ({ file, line, message });

/** A product page whose frontmatter carries exactly the given keys. */
const page = (keys, body = "# Title\n") => `---\n${keys}\n---\n\n${body}`;

const summary = 'summary: "What the page answers"\n';
const reasons = "read_when:\n  - a reason the model would open it\n";

test("a slug drops punctuation, keeps underscores and turns spaces into hyphens", () => {
  assert.equal(slugify("Result bounds"), "result-bounds");
  assert.equal(slugify("Purpose & Arguments"), "purpose--arguments");
  assert.equal(slugify("  File:// aliases  "), "file-aliases");
  assert.equal(slugify("front_matter"), "front_matter");
  assert.equal(slugify("kb:// locators"), "kb-locators");
});

test("frontmatter is metadata, not a setext heading over its own block", () => {
  const anchors = headingAnchors(
    '---\nsummary: "What it answers"\nconfigured_by:\n  - ../../operator/x.md\n---\n\n# Read\n',
  );

  assert.deepEqual([...anchors], ["read"]);
});

test("a repeated heading is numbered the way GitHub numbers it", () => {
  const anchors = headingAnchors("## Purpose\n\n## Purpose\n\n## Purpose\n");

  assert.deepEqual([...anchors], ["purpose", "purpose-1", "purpose-2"]);
});

test("markup inside a heading contributes no anchor characters", () => {
  const anchors = headingAnchors("## `kb://` and [skill.md](skill.md)\n");

  assert.ok(anchors.has("kb-and-skillmd"));
});

test("an underline that dedents out of a list is a thematic break", () => {
  assert.deepEqual([...headingAnchors("* apple\n* banana\n---\n")], []);
  assert.deepEqual([...headingAnchors("- banana\n---\n")], []);
  // The same underline, indented into the item, is a heading GitHub creates.
  assert.deepEqual([...headingAnchors("- banana\n  ---\n")], ["banana"]);
});

test("a setext underline is measured from the item's content column", () => {
  // CommonMark allows three columns past the block it underlines, so an
  // underline indented further into a list item still names its heading.
  assert.deepEqual([...headingAnchors("- Child\n    ---\n")], ["child"]);
  assert.deepEqual([...headingAnchors("1. Child\n    ---\n")], ["child"]);
  assert.deepEqual(
    [...headingAnchors("- Parent\n    - Child\n      ---\n")],
    ["child"],
  );
  // Dedenting out of the item leaves it a thematic break again.
  assert.deepEqual([...headingAnchors("- Parent\n    - Child\n    ---\n")], []);
  assert.deepEqual(
    [...headingAnchors("- Child\n      ---\n")],
    [],
    "four columns past the content is an indented code block",
  );
});

test("a heading nested in a list item carries GitHub's anchor", () => {
  assert.deepEqual([...headingAnchors("- ## Nested\n")], ["nested"]);
  assert.deepEqual([...headingAnchors("1. ## Nested\n")], ["nested"]);
  // Four columns past the item content is code, not a heading.
  assert.deepEqual([...headingAnchors("- item\n\n    ## deep\n")], ["deep"]);
  assert.deepEqual([...headingAnchors("- item\n\n      ## code\n")], []);
});

test("a heading inside a fenced block is not an anchor", () => {
  const anchors = headingAnchors(
    "# Read\n\n```md\n## Example only\n```\n\n## Bounds\n",
  );

  assert.deepEqual([...anchors], ["read", "bounds"]);
});

test("a link sample inside a fence or a code span is prose, not a link", () => {
  const text = [
    "# Title",
    "",
    "```md",
    "[read](gone.md)",
    "```",
    "",
    "Write `[edit](gone.md)` to link a document.",
    "",
  ].join("\n");

  assert.deepEqual(extractLinks(text), []);
});

test("links are reported with the line they are written on", () => {
  const text = "# Title\n\nSee [files](operator/native-files.md) first.\n";

  assert.deepEqual(extractLinks(text), [
    { line: 3, target: "operator/native-files.md" },
  ]);
});

test("a link to a file that does not exist is reported at its line", (t) => {
  const root = repository(t, {
    "docs/index.md": "# Docs\n\nSee [nope](missing.md).\n",
  });

  assert.deepEqual(check(root, "docs/index.md"), [
    problem("docs/index.md", 3, "no such file: missing.md"),
  ]);
});

test("a fragment that names no heading in the target document is reported", (t) => {
  const root = repository(t, {
    "docs/index.md": "# Docs\n\nSee [read](../tools/read.md#purpose).\n",
    "tools/read.md": "# Read\n\n## Arguments\n",
  });

  assert.deepEqual(check(root, "docs/index.md"), [
    problem(
      "docs/index.md",
      3,
      'no heading slug "purpose" in ../tools/read.md',
    ),
  ]);
});

test("a same-file fragment resolves against this document's own headings", (t) => {
  const root = repository(t, {
    "docs/index.md": "# Docs\n\nSee [below](#tools).\n\n## Tools\n",
  });

  assert.deepEqual(check(root, "docs/index.md"), []);
});

test("a heading in another document is not this document's anchor", (t) => {
  const root = repository(t, {
    "docs/index.md": "# Docs\n\nSee [read](../tools/read.md#bounds).\n",
    "tools/read.md": "# Read\n\n## Arguments\n",
    "tools/write.md": "# Write\n\n## Bounds\n",
  });

  assert.deepEqual(check(root, "docs/index.md"), [
    problem("docs/index.md", 3, 'no heading slug "bounds" in ../tools/read.md'),
  ]);
});

test("link text wrapped over two lines is still one link", () => {
  const text =
    "# Title\n\nSee [the measurements and\nalternatives](../research/x.md).\n";

  assert.deepEqual(extractLinks(text), [
    { line: 3, target: "../research/x.md" },
  ]);
});

test("a destination in angle brackets or before a title is the path", () => {
  const text = [
    "# Title",
    "",
    '[one](<../a b/read.md>) [two](../read.md "The read tool")',
    "[three](../read.md 'Single quoted') [four](../read.md (Parens))",
    "",
  ].join("\n");

  assert.deepEqual(
    extractLinks(text).map((link) => link.target),
    ["../a b/read.md", "../read.md", "../read.md", "../read.md"],
  );
});

test("a reference definition is a link destination too", (t) => {
  const root = repository(t, {
    "docs/report.md":
      '# Report\n\nSee [the harness][harness].\n\n[harness]: harness/index.md\n[gone]: gone.md "Deleted"\n',
    "docs/harness/index.md": "# Harnesses\n",
  });

  assert.deepEqual(check(root, "docs/report.md"), [
    problem("docs/report.md", 6, "no such file: gone.md"),
  ]);
});

test("a footnote definition is a paragraph, not a destination", (t) => {
  const root = repository(t, {
    "docs/report.md":
      "# Report\n\n[^note]: User-provided `analysis.md`, received 2026-09-24.\n\n[^citation]: [Harness](https://example.invalid/harness.md)\n",
  });

  assert.deepEqual(check(root, "docs/report.md"), []);
});

test("a footnote naming a path is prose, not a dangling destination", (t) => {
  const root = repository(t, {
    "docs/report.md":
      "# Report\n\n[^note]: gone.md\n\n[^src]: ../src/keep.ts\n",
  });

  assert.deepEqual(check(root, "docs/report.md"), []);
});

test("a query string is not part of the file it selects", (t) => {
  const root = repository(t, {
    "docs/report.md":
      "# Report\n\n[raw](harness/index.md?raw=1) [section](harness/index.md?x=1#tools)\n",
    "docs/harness/index.md": "# Harnesses\n\n## Tools\n",
  });

  assert.deepEqual(check(root, "docs/report.md"), []);
});

test("an external link is nobody's file to resolve", (t) => {
  const root = repository(t, {
    "docs/index.md":
      "# Docs\n\n[spec](https://example.invalid/spec.md) [mail](mailto:a@example.invalid).\n",
  });

  assert.deepEqual(check(root, "docs/index.md"), []);
});

test("a directory carries no heading, so a fragment cannot resolve into it", (t) => {
  const root = repository(t, {
    "docs/index.md": "# Docs\n\n[specs](../openspec/specs#tool-calling)\n",
    "openspec/specs/keep.md": "",
  });

  assert.deepEqual(check(root, "docs/index.md"), [
    problem(
      "docs/index.md",
      3,
      "not a document, so it has no anchor: ../openspec/specs#tool-calling",
    ),
  ]);
});

test("a source citation is addressed by line, so no heading is expected", (t) => {
  const root = repository(t, {
    "docs/research/tool-harness/report.md":
      "# Report\n\nSee [run](../../../apps/api/src/run.ts#L12-L20).\n",
    "apps/api/src/run.ts": "export const run = 1;\n",
  });

  assert.deepEqual(check(root, "docs/research/tool-harness/report.md"), []);
});

test("a heading anchor into a source file resolves against nothing", (t) => {
  const root = repository(t, {
    "docs/research/tool-harness/report.md":
      "# Report\n\nSee [run](../../../apps/api/src/run.ts#purpose).\n",
    "apps/api/src/run.ts": "export const run = 1;\n",
  });

  assert.deepEqual(check(root, "docs/research/tool-harness/report.md"), [
    problem(
      "docs/research/tool-harness/report.md",
      3,
      "not a document, so it has no anchor: ../../../apps/api/src/run.ts#purpose",
    ),
  ]);
});

test("a product page without a summary is reported on the frontmatter", (t) => {
  const root = repository(t, {
    "docs/product/operator/scaling.md": page(reasons),
  });

  assert.deepEqual(check(root, "docs/product/operator/scaling.md"), [
    problem(
      "docs/product/operator/scaling.md",
      1,
      'frontmatter is missing "summary"',
    ),
  ]);
});

test("a product page must say when to open it", (t) => {
  const root = repository(t, {
    "docs/product/operator/scaling.md": page(summary),
  });

  assert.deepEqual(check(root, "docs/product/operator/scaling.md"), [
    problem(
      "docs/product/operator/scaling.md",
      1,
      'frontmatter is missing "read_when"',
    ),
  ]);
});

test("an empty read_when entry is reported on its own line", (t) => {
  const root = repository(t, {
    "docs/product/operator/scaling.md": page(
      `${summary}read_when:\n  - "  "\n`,
    ),
  });

  assert.deepEqual(check(root, "docs/product/operator/scaling.md"), [
    problem(
      "docs/product/operator/scaling.md",
      4,
      '"read_when" has an empty entry',
    ),
  ]);
});

test("a reference page names the capability that owns its behavior", (t) => {
  const root = repository(t, {
    "docs/product/reference/tools/read.md": page(summary + reasons),
  });

  assert.deepEqual(check(root, "docs/product/reference/tools/read.md"), [
    problem(
      "docs/product/reference/tools/read.md",
      1,
      'frontmatter is missing "spec"',
    ),
  ]);
});

test("a reference page may name one capability or several", (t) => {
  const root = repository(t, {
    "openspec/specs/native-file-tools/spec.md": "# native-file-tools\n",
    "openspec/specs/web-read/spec.md": "# web-read\n",
    "docs/product/reference/tools/read.md": page(
      `${summary}${reasons}spec: native-file-tools\n`,
    ),
    "docs/product/reference/selectors.md": page(
      `${summary}${reasons}spec:\n  - native-file-tools\n  - web-read\n`,
    ),
  });

  assert.deepEqual(check(root, "docs/product/reference/tools/read.md"), []);
  assert.deepEqual(check(root, "docs/product/reference/selectors.md"), []);
});

test("a spec naming no capability directory is reported on its line", (t) => {
  const root = repository(t, {
    "openspec/specs/native-file-tools/spec.md": "# native-file-tools\n",
    "docs/product/reference/tools/read.md": page(
      `${summary}${reasons}spec: web-fetching\n`,
    ),
  });

  assert.deepEqual(check(root, "docs/product/reference/tools/read.md"), [
    problem(
      "docs/product/reference/tools/read.md",
      5,
      "no capability directory: openspec/specs/web-fetching",
    ),
  ]);
});

test("a spec naming a file where a capability directory belongs is reported", (t) => {
  const root = repository(t, {
    "openspec/specs/native-file-tools": "# not a directory\n",
    "docs/product/reference/tools/read.md": page(
      `${summary}${reasons}spec: native-file-tools\n`,
    ),
  });

  assert.deepEqual(check(root, "docs/product/reference/tools/read.md"), [
    problem(
      "docs/product/reference/tools/read.md",
      5,
      "no capability directory: openspec/specs/native-file-tools",
    ),
  ]);
});

test("a spec must name a capability directory, not a path that reaches one", (t) => {
  const escapes = {
    "parent.md": "../../docs",
    "grouped.md": "grouped/shared",
  };
  const root = repository(t, {
    "openspec/specs/native-file-tools/spec.md": "# native-file-tools\n",
    "docs/index.md": "# Docs\n",
    ...Object.fromEntries(
      Object.entries(escapes).map(([file, spec]) => [
        `docs/product/reference/tools/${file}`,
        page(`${summary}${reasons}spec: ${spec}\n`),
      ]),
    ),
  });
  mkdirSync(path.join(root, "openspec/specs/grouped/shared"), {
    recursive: true,
  });
  // A capability directory reached by a symlink is not the capability itself.
  symlinkSync(
    path.join(root, "docs"),
    path.join(root, "openspec/specs/escape"),
    "dir",
  );
  writeFileSync(
    path.join(root, "docs/product/reference/tools/symlink.md"),
    page(`${summary}${reasons}spec: escape\n`),
  );
  escapes["symlink.md"] = "escape";

  // A path that lands back on a capability directory names one, `..` or not.
  writeFileSync(
    path.join(root, "docs/product/reference/tools/sibling.md"),
    page(`${summary}${reasons}spec: ../specs/native-file-tools\n`),
  );
  assert.deepEqual(check(root, "docs/product/reference/tools/sibling.md"), []);

  for (const [file, spec] of Object.entries(escapes))
    assert.deepEqual(check(root, `docs/product/reference/tools/${file}`), [
      problem(
        `docs/product/reference/tools/${file}`,
        5,
        `no capability directory: openspec/specs/${spec}`,
      ),
    ]);

  // A capability directory by name still resolves.
  writeFileSync(
    path.join(root, "docs/product/reference/tools/read.md"),
    page(`${summary}${reasons}spec: native-file-tools\n`),
  );
  assert.deepEqual(check(root, "docs/product/reference/tools/read.md"), []);
});

test("a page points at pages that exist, one key or a list of them", (t) => {
  const root = repository(t, {
    "openspec/specs/native-file-tools/spec.md": "# native-file-tools\n",
    "docs/product/operator/moved-away.md": page(summary + reasons),
    "docs/product/operator/native-files.md": page(
      `${summary}${reasons}behavior:\n  - ../reference/tools/read.md\n  - ../reference/tools/gone.md\n`,
    ),
    "docs/product/reference/tools/read.md": page(
      `${summary}${reasons}spec: native-file-tools\nconfigured_by: ../moved-away.md\n`,
    ),
  });

  assert.deepEqual(check(root, "docs/product/operator/native-files.md"), [
    problem(
      "docs/product/operator/native-files.md",
      7,
      "no such file: ../reference/tools/gone.md",
    ),
  ]);
  assert.deepEqual(check(root, "docs/product/reference/tools/read.md"), [
    problem(
      "docs/product/reference/tools/read.md",
      6,
      "no such file: ../moved-away.md",
    ),
  ]);
});

test("an index page owns several capabilities, so it needs no spec", (t) => {
  const root = repository(t, {
    "docs/product/reference/index.md": page(summary + reasons),
    "docs/product/reference/tools/index.md": page(summary + reasons),
  });

  assert.deepEqual(check(root, "docs/product/reference/index.md"), []);
  assert.deepEqual(check(root, "docs/product/reference/tools/index.md"), []);
});

test("a document outside docs/product carries no frontmatter obligation", (t) => {
  const root = repository(t, {
    "docs/index.md": "# Docs\n\nSee [below](#tools).\n\n## Tools\n",
  });

  assert.deepEqual(check(root, "docs/index.md"), []);
});

test("the ignore list is the markdownlint configuration's own", () => {
  assert.equal(isIgnored("CLAUDE.md"), true);
  assert.equal(isIgnored("GEMINI.md"), true);
  // Prompt prose Markdownlint still lints is this checker's to resolve too.
  assert.equal(isIgnored("apps/api/src/prompts/chat-default.md"), false);
});

test("a target outside the repository is rejected, symlink or not", (t) => {
  const root = repository(t, {
    "docs/index.md":
      "# Docs\n\n[out](../../outside.md) [via link](escape.md)\n",
  });
  const outside = path.join(path.dirname(root), "outside.md");
  writeFileSync(outside, "# Outside\n");
  symlinkSync(outside, path.join(root, "docs", "escape.md"));
  t.after(() => rmSync(outside, { force: true }));

  assert.deepEqual(check(root, "docs/index.md"), [
    problem("docs/index.md", 3, "outside the repository: ../../outside.md"),
    problem("docs/index.md", 3, "outside the repository: escape.md"),
  ]);
});

test("the documents markdownlint ignores are not this checker's to read", () => {
  assert.equal(isIgnored(".claude/skills/review/SKILL.md"), true);
  assert.equal(isIgnored("apps/api/CLAUDE.md"), true);
  assert.equal(isIgnored("apps/api/src/prompts/tools/read.md"), true);
  assert.equal(isIgnored("apps/api/src/knowledge/prompts/system.md"), true);
  assert.equal(isIgnored("docs/product/reference/index.md"), false);
});
