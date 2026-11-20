/**
 * Prose checker for architecture decision records.
 *
 * ADRs explain why a decision was made, and a reader meets them long after the
 * discussion that produced them. `docs/AGENTS.md` sets the prose rules for
 * every page under `docs/`. This script enforces the mechanical subset on
 * `docs/adr/`, the tree that was written to those rules from the start. Other
 * trees predate the rules and follow them as they are edited.
 *
 * It reads prose only: frontmatter, fenced and indented code, code spans, link
 * targets, and table rows are skipped. Each problem names its file and line.
 */

import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** The tree this script enforces. */
const scopePrefix = "docs/adr/";

/** Sentences longer than this fail; the written target is about 25 words. */
export const maxSentenceWords = 35;

/**
 * Words that mark generated prose (unslop rules 7 and 31). Each entry is a
 * stem; common inflections match too.
 */
const bannedStems = [
  "additionally",
  "crucial",
  "delve",
  "enhance",
  "foster",
  "landscape",
  "leverage",
  "pivotal",
  "showcase",
  "testament",
  "underscore",
  "utilize",
  "vibrant",
];

const bannedWord = new RegExp(
  String.raw`\b(${bannedStems.join("|")})(s|d|ed|es|ing|ments?|ly)?\b`,
  "giu",
);

const characterRules = [
  { pattern: /[\u2013\u2014]/u, message: "dash used as punctuation" },
  { pattern: /[\u2018\u2019\u201c\u201d]/u, message: "curly quote" },
  { pattern: /;/u, message: "semicolon in prose: write two sentences" },
];

/** A line with its code spans and link targets removed. */
function proseText(line) {
  return line
    .replaceAll(/`[^`]*`/gu, " ")
    .replaceAll(/\]\([^)]*\)/gu, "]")
    .replaceAll(/<https?:[^>]*>/gu, " ");
}

/**
 * The prose lines of a document, each with its 1-based line number. A blank
 * line, a heading, or a list marker starts a new block.
 */
function proseBlocks(text) {
  const blocks = [];
  let block = undefined;
  let fence = undefined;
  const lines = text.split("\n");
  const close = () => {
    if (block !== undefined) blocks.push(block);
    block = undefined;
  };

  for (const [index, line] of lines.entries()) {
    const number = index + 1;
    const fenceMatch = /^\s*(```|~~~)/u.exec(line);

    if (index === 0 && line.trim() === "---") {
      fence = "---";
      continue;
    }

    if (fence !== undefined) {
      if (
        (fence === "---" && line.trim() === "---") ||
        fenceMatch?.[1] === fence
      )
        fence = undefined;
      continue;
    }

    if (fenceMatch !== null) {
      close();
      fence = fenceMatch[1];
      continue;
    }

    const trimmed = line.trim();

    if (trimmed === "" || trimmed.startsWith("|") || /^ {4}/u.test(line)) {
      close();
      continue;
    }

    if (/^(#{1,6}\s|[-*+]\s|\d+\.\s)/u.test(trimmed)) close();
    block ??= [];
    block.push({
      number,
      text: proseText(trimmed.replace(/^(#{1,6}|[-*+]|\d+\.)\s+/u, "")),
    });
  }

  close();

  return blocks;
}

/** Every rule a block breaks, located at the line that breaks it. */
function blockProblems(block) {
  const problems = [];

  for (const { number, text } of block) {
    for (const { pattern, message } of characterRules)
      if (pattern.test(text)) problems.push({ line: number, message });

    for (const match of text.matchAll(bannedWord))
      problems.push({ line: number, message: `banned word "${match[0]}"` });
  }

  let words = 0;
  let start = block[0].number;

  for (const { number, text } of block) {
    for (const token of text.split(/\s+/u).filter(Boolean)) {
      if (words === 0) start = number;
      words += 1;

      if (/[.!?]["')\]]*$/u.test(token)) {
        if (words > maxSentenceWords)
          problems.push({
            line: start,
            message: `sentence of ${words} words: split it (limit ${maxSentenceWords})`,
          });
        words = 0;
      }
    }
  }

  if (words > maxSentenceWords)
    problems.push({
      line: start,
      message: `sentence of ${words} words: split it (limit ${maxSentenceWords})`,
    });

  return problems;
}

/** Every problem in one document's text. */
export function checkText(text) {
  return proseBlocks(text)
    .flatMap(blockProblems)
    .sort((a, b) => a.line - b.line);
}

/** The documents in scope that exist; loader aliases are symlinks and skipped. */
export function documentsInScope(root, candidates) {
  const files =
    candidates ??
    execFileSync("git", ["ls-files", "--", `${scopePrefix}*.md`], {
      cwd: root,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);

  return files.filter(
    (file) =>
      file.startsWith(scopePrefix) &&
      file.endsWith(".md") &&
      lstatSync(path.join(root, file), { throwIfNoEntry: false })?.isFile() ===
        true,
  );
}

function main() {
  const root = repositoryRoot;
  const args = process.argv
    .slice(2)
    .map((file) =>
      path.relative(root, path.resolve(file)).split(path.sep).join("/"),
    );
  const files = documentsInScope(root, args.length > 0 ? args : undefined);
  let failed = false;

  for (const file of files) {
    for (const { line, message } of checkText(
      readFileSync(path.join(root, file), "utf8"),
    )) {
      console.error(`${file}:${line}: ${message}`);
      failed = true;
    }
  }

  if (failed) process.exitCode = 1;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  main();
