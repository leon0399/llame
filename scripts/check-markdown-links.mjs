/**
 * Markdown link and product-page frontmatter checker.
 *
 * The docs are read by humans on GitHub *and* served to the model through a
 * `llame://docs/` locator, so a stale relative link is a real defect: nothing
 * in the rendered page tells the reader that the target moved. Markdownlint
 * owns document style, this script owns resolution — every relative link must
 * reach a file that exists, every fragment must equal a heading slug in the
 * document it points at, and every product page must carry the frontmatter the
 * docs listing prints, including the pages it points at and the capability it
 * belongs to.
 *
 * The scope mirrors `.markdownlint-cli2.jsonc`: what that file ignores is not
 * documentation, so its links belong to another contract (the provider prompt
 * contract, upstream agent skills). `docs/research/**` is in scope for links
 * like everything else — a research bundle that renames a document leaves a
 * dangling citation behind — while its external citations are untouched,
 * since this checker resolves relative paths only. Frontmatter obligations
 * stay scoped to `docs/product/`, the tree the `llame://docs/` listing prints.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The documents markdownlint-cli2 ignores: other contracts, not docs. */
export const ignoredGlobs = [
  ".agents/skills/**",
  ".claude/skills/**",
  ".codex/skills/**",
  ".opencode/skills/**",
  "**/CLAUDE.md",
  "**/GEMINI.md",
  "apps/api/src/prompts/**",
  "apps/api/src/*/prompts/**",
];

/** Pages whose frontmatter the `llame://docs/` listing prints. */
export const productPrefix = "docs/product/";

/** Reference pages name the capability that owns the behavior they state. */
export const referencePrefix = "docs/product/reference/";

/** An index page lists several capabilities, so it owns no single one. */
const indexName = "index.md";

/** The capability directories a `spec` value must name, under the repository. */
const capabilityRoot = "openspec/specs";

/** Frontmatter keys that hold links to the pages configuring this one. */
const pointerKeys = ["configured_by", "behavior"];

/** `git ls-files` on a wide tree is not a pipe-sized answer. */
const gitStdoutMaxBuffer = Number.MAX_SAFE_INTEGER;

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** Matches one `.markdownlint-cli2.jsonc` ignore pattern against a path. */
function matchesGlob(glob, file) {
  const source = escapeRegExp(glob)
    .replace(/\\\*\\\*/gu, "@@")
    .replace(/\\\*/gu, "[^/]*")
    .replace(/@@/gu, ".*");
  return new RegExp(`^${source}$`, "u").test(file);
}

/** Whether markdownlint's configuration already skips the document. */
export function isIgnored(file) {
  return ignoredGlobs.some((glob) => matchesGlob(glob, file));
}

const toPosix = (file) => file.split(path.sep).join("/");

/**
 * GitHub's heading slug: lowercase, then everything but letters, digits,
 * spaces, hyphens and underscores dropped, then every space a hyphen.
 */
export function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/gu, "-");
}

/** The heading text as GitHub reads it: markup holds no anchor character. */
function headingText(heading) {
  return heading
    .replace(/`+([^`]*)`+/gu, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]*)\]\[[^\]]*\]/gu, "$1")
    .replace(/<\/?[A-Za-z][^>]*>/gu, "")
    .replace(/[*_~]+/gu, "")
    .trim();
}

/** The fence a line opens, `null` for prose and for the line that closes one. */
function fenceMarker(line) {
  const marker = /^\s{0,3}(`{3,}|~{3,})[^`~]*$/u.exec(line);
  return marker ? marker[1] : null;
}

/** Whether a line closes the open fence: same character, at least as long. */
function closesFence(line, fence) {
  return new RegExp(`^\\s{0,3}${fence[0]}{${fence.length},}\\s*$`, "u").test(
    line,
  );
}

/** The first content line: a leading `---` block is metadata, not headings. */
function contentStart(lines) {
  if (lines[0] !== "---") return 0;
  const end = lines.indexOf("---", 1);
  return end < 0 ? 0 : end + 1;
}

/**
 * Every anchor a document offers: the ATX and setext headings outside fenced
 * code, a repeated slug numbered `-1`, `-2`, ... the way GitHub numbers them,
 * so the second `## Purpose` is `purpose-1`.
 */
export function headingAnchors(text) {
  const anchors = new Set();
  const repeats = new Map();
  const add = (heading) => {
    const slug = slugify(headingText(heading));
    if (!slug) return;
    const seen = repeats.get(slug) ?? 0;
    repeats.set(slug, seen + 1);
    anchors.add(seen === 0 ? slug : `${slug}-${seen}`);
  };
  const lines = text.split("\n");
  const first = contentStart(lines);
  let fence = null;
  for (const [index, line] of lines.entries()) {
    if (index < first) continue;
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    const marker = fenceMarker(line);
    if (marker) {
      fence = marker;
      continue;
    }
    const atx = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/u.exec(line);
    if (atx) {
      add(atx[1]);
      continue;
    }
    const underline = lines[index + 1];
    if (
      underline !== undefined &&
      /^\s{0,3}(?:=+|-+)\s*$/u.test(underline) &&
      line.trim().length > 0
    )
      add(line);
  }
  return anchors;
}

/** Blanks code spans and fenced blocks, keeping every line of the document. */
function maskCode(text) {
  let fence = null;
  return text
    .split("\n")
    .map((line) => {
      if (fence) {
        if (closesFence(line, fence)) fence = null;
        return "";
      }
      const marker = fenceMarker(line);
      if (marker) {
        fence = marker;
        return "";
      }
      return line.replace(/(`+).*?\1/gu, (span) => " ".repeat(span.length));
    })
    .join("\n");
}

/**
 * The destination of an inline link or a reference definition: the `<...>`
 * form, or the path before any title. CommonMark allows both, and so does a
 * title in either quote style or parentheses, none of which is part of the
 * destination.
 */
function destination(raw) {
  const angle = /^<([^<>]*)>/u.exec(raw.trim());
  if (angle) return angle[1];
  return raw.trim().split(/\s+/u)[0] ?? "";
}

/** Link text may wrap, but never across the blank line that ends a paragraph. */
const linkText = String.raw`(?:[^\]\n]|\n(?![ \t]*\n))*`;

/** The parenthesis form, whose title may itself be parenthesised. */
const inlineDestination = String.raw`(?:\([^()]*\)|[^()])*`;

const inlineLink = new RegExp(
  String.raw`\[${linkText}\]\(\s*(${inlineDestination})\)`,
  "gu",
);

const referenceDefinition = /^ {0,3}\[[^\]\n]+\]:[ \t]*(.*)$/gmu;

/**
 * CommonMark reads `[label]: destination "title"` and nothing else as a link
 * definition. A GitHub footnote is `[^id]: prose`, and a footnote wrapping a
 * citation is `[^id]: [text](url)`: the inner link is an ordinary link the
 * inline scan already read, and neither the label nor its wrapper is a path.
 */
const definitionBody =
  /^(?:<[^<>\n]*>|\S+)(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?[ \t]*$/u;

const footnoteBody = /^\[|\]\(/u;

/**
 * Every link destination in a document, with the line it starts on: the inline
 * links, including text wrapped over several lines, and the reference
 * definitions a research bundle cites with. A Markdown sample inside a fence
 * or a code span is prose *about* links rather than a link, so those
 * characters are masked before the scan.
 */
export function extractLinks(text) {
  const masked = maskCode(text);
  const links = [];
  for (const match of masked.matchAll(inlineLink)) {
    const line = masked.slice(0, match.index).split("\n").length;
    const target = destination(match[1]);
    if (target !== "") links.push({ line, target });
  }
  for (const match of masked.matchAll(referenceDefinition)) {
    if (footnoteBody.test(match[1].trim())) continue;
    if (!definitionBody.test(match[1].trim())) continue;
    const line = masked.slice(0, match.index).split("\n").length;
    const target = destination(match[1]);
    if (target !== "") links.push({ line, target });
  }
  return links;
}

/** Reads a file, or `null` when it cannot be read at all. */
function readFileOrNull(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

const unquote = (value) => value.replace(/^(['"])(.*)\1$/u, "$2").trim();

/**
 * The frontmatter keys of a document, mapped to the line each was declared on.
 * A value is a string, or a list of `{ line, value }` for a block sequence --
 * the three shapes this repository writes, which a line parser reads exactly.
 */
function parseFrontmatter(text) {
  const lines = text.split("\n");
  const first = contentStart(lines);
  if (first === 0) return null;
  const keys = new Map();
  let key = null;
  let item = null;
  for (const [index, line] of lines.slice(1, first - 1).entries()) {
    const declaration = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/u.exec(line);
    if (declaration) {
      key = { line: index + 2, value: unquote(declaration[2]) };
      keys.set(declaration[1], key);
      item = null;
      continue;
    }
    const entry = /^[ \t]+-[ \t]*(.*)$/u.exec(line);
    if (entry) {
      if (!key) continue;
      item = { line: index + 2, value: unquote(entry[1]) };
      // A block sequence carries no inline value of its own; a key written
      // with one keeps it, since no nested list is written here.
      if (key.value === "") key.value = [item];
      else if (Array.isArray(key.value)) key.value.push(item);
      continue;
    }
    if (item && /^[ \t]+\S/u.test(line))
      item.value = `${item.value} ${line.trim()}`;
  }
  return keys;
}

/** The list form of a key, whether it was written inline or as a sequence. */
function asItems(entry) {
  if (!entry) return [];
  if (Array.isArray(entry.value)) return entry.value;
  return entry.value === "" ? [] : [{ line: entry.line, value: entry.value }];
}

const decode = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const isExternal = (target) =>
  /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(target) ||
  target.startsWith("//") ||
  target.startsWith("/");

/** GitHub addresses source by line (`#L12`, `#L12-L20`), not by heading. */
const lineAnchor = /^L\d+(?:-L\d+)?$/u;

/** A heading anchor means something only in a Markdown document. */
const isMarkdown = (file) => /\.(?:md|markdown)$/iu.test(file);

/**
 * What is wrong with one relative link, or `null` when it resolves: the target
 * must exist, and a fragment must name a heading in it or a line in a file
 * GitHub renders with line numbers.
 */
function linkProblem(context, line, target) {
  const { name, file, text, readFile } = context;
  if (target === "" || isExternal(target)) return null;
  const hash = target.indexOf("#");
  const locator = decode(hash < 0 ? target : target.slice(0, hash));
  const fragment = hash < 0 ? "" : decode(target.slice(hash + 1));
  if (locator === "" && fragment === "") return null;
  const sameFile = locator === "";
  const resolved = sameFile ? file : path.resolve(path.dirname(file), locator);
  const stats = statSync(resolved, { throwIfNoEntry: false });
  if (!stats) return { file: name, line, message: `no such file: ${target}` };
  if (fragment === "") return null;
  if (!stats.isFile())
    return {
      file: name,
      line,
      message: `not a document, so it has no anchor: ${target}`,
    };
  // GitHub addresses a source file, and a document, by line as well as by
  // heading, so a line anchor resolves without a slug to match.
  if (lineAnchor.test(fragment)) return null;
  if (!sameFile && !isMarkdown(locator))
    return {
      file: name,
      line,
      message: `not a document, so it has no anchor: ${target}`,
    };
  const content = sameFile ? text : readFile(resolved);
  if (content === null)
    return { file: name, line, message: `cannot read: ${target}` };
  if (headingAnchors(content).has(fragment)) return null;
  return {
    file: name,
    line,
    message: sameFile
      ? `no heading slug "${fragment}" in this document`
      : `no heading slug "${fragment}" in ${locator}`,
  };
}

/** Every link in the body of the document. */
function linkProblems(context) {
  return extractLinks(context.text)
    .map(({ line, target }) => linkProblem(context, line, target))
    .filter((problem) => problem !== null);
}

/** Every product page states what it is, when to open it, and what owns it. */
function frontmatterProblems(context) {
  const { name, text, readFile, root } = context;
  const keys = parseFrontmatter(text);
  if (!keys)
    return [
      {
        file: name,
        line: 1,
        message:
          'frontmatter must open on line 1 with "---" and close the block',
      },
    ];
  const problems = [];
  const report = (line, message) =>
    problems.push({ file: name, line, message });

  const summary = keys.get("summary");
  if (!summary) report(1, 'frontmatter is missing "summary"');
  else if (Array.isArray(summary.value))
    report(summary.line, '"summary" must be one string, not a list');
  else if (!summary.value) report(summary.line, '"summary" is empty');

  const reasons = keys.get("read_when");
  if (!reasons) report(1, 'frontmatter is missing "read_when"');
  else {
    const items = asItems(reasons);
    if (items.length === 0)
      report(reasons.line, '"read_when" must list at least one reason');
    else {
      const empty = items.find((entry) => !entry.value);
      if (empty) report(empty.line, '"read_when" has an empty entry');
    }
  }

  // The pages that configure this one are links a reader can follow, so a move
  // that renames one leaves a dangling pointer in the listing.
  for (const key of pointerKeys)
    for (const entry of asItems(keys.get(key))) {
      if (!entry.value) continue;
      const problem = linkProblem(context, entry.line, entry.value);
      if (problem) problems.push(problem);
    }

  // An index page owns several capabilities, so it names no single `spec`.
  if (
    name.startsWith(referencePrefix) &&
    path.posix.basename(name) !== indexName
  ) {
    const spec = keys.get("spec");
    if (!spec) report(1, 'frontmatter is missing "spec"');
    else {
      const items = asItems(spec);
      if (items.every((entry) => !entry.value))
        report(spec.line, '"spec" must name a capability');
      else
        for (const entry of items)
          if (
            entry.value &&
            !existsSync(path.join(root, capabilityRoot, entry.value))
          )
            report(
              entry.line,
              `no capability directory: ${capabilityRoot}/${entry.value}`,
            );
    }
  }
  return problems;
}

/**
 * Every problem one document has: an unresolvable link, a dangling fragment, or
 * frontmatter a `docs/product/` listing cannot render. `readFile` is injectable
 * so a caller can serve documents from anywhere.
 */
export function checkFile(file, options = {}) {
  const { root = path.dirname(file), readFile = readFileOrNull } = options;
  const name = toPosix(path.relative(root, file));
  const source = readFile(file);
  if (source === null)
    return [{ file: name, line: 1, message: "cannot be read" }];
  const text = source.replace(/\r\n?/gu, "\n");
  const context = { name, file, text, readFile, root };
  return [
    ...(name.startsWith(productPrefix) ? frontmatterProblems(context) : []),
    ...linkProblems(context),
  ];
}

function git(arguments_, cwd) {
  // A Git hook exports GIT_INDEX_FILE and friends; inherited, they answer for
  // the hook's index instead of the working tree this checker reads.
  const environment = { ...process.env };
  for (const variable of execFileSync(
    "git",
    ["rev-parse", "--local-env-vars"],
    { cwd, encoding: "utf8" },
  )
    .trim()
    .split("\n"))
    delete environment[variable];
  return execFileSync("git", arguments_, {
    cwd,
    encoding: "utf8",
    env: environment,
    maxBuffer: gitStdoutMaxBuffer,
    stdio: ["ignore", "pipe", "inherit"],
  });
}

/** Every tracked Markdown document this checker owns. */
export function trackedDocuments(root) {
  return git(["ls-files", "-z", "--", "*.md"], root)
    .split("\0")
    .filter((file) => file !== "" && !isIgnored(toPosix(file)))
    .map((file) => path.join(root, file));
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  // Every document is read once, and every link target once more at most.
  const cache = new Map();
  const readFile = (file) => {
    if (!cache.has(file)) cache.set(file, readFileOrNull(file));
    return cache.get(file);
  };
  const problems = trackedDocuments(root).flatMap((file) =>
    checkFile(file, { root, readFile }),
  );
  for (const problem of problems)
    console.log(`${problem.file}:${problem.line}: ${problem.message}`);
  if (problems.length > 0) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  main();
