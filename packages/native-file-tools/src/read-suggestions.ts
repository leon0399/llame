import { lstat, opendir } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { DIRECTORY_TRAVERSAL_BUDGET } from "./directory-listing";
import { isNodeError } from "./path";

const SCORING_CELL_BUDGET = 8_000_000;
const MIN_SIMILARITY = 0.5;
const NOT_FOUND = "File not found.";

/** The original miss remains authoritative if inspecting its parent fails. */
export async function missingFileMessage(
  hostPath: string,
  followSymlinks: boolean,
): Promise<string> {
  try {
    const parent = dirname(hostPath);
    const stats = await lstat(parent);
    if (!followSymlinks && stats.isSymbolicLink()) return NOT_FOUND;
    const names = await siblingNames(parent);
    const suggestions = similarNames(basename(hostPath), names);
    return suggestions.length === 0
      ? NOT_FOUND
      : `${NOT_FOUND} Similar names in the same directory: ${suggestions.join(", ")}.`;
  } catch (error) {
    return isNodeError(error) && error.code === "ENOENT"
      ? `${NOT_FOUND} Parent directory does not exist.`
      : NOT_FOUND;
  }
}

async function siblingNames(parent: string): Promise<Array<string>> {
  const directory = await opendir(parent);
  try {
    const names: Array<string> = [];
    for (
      let entry = await directory.read();
      entry !== null;
      entry = await directory.read()
    ) {
      if (names.length === DIRECTORY_TRAVERSAL_BUDGET) return [];
      names.push(entry.name);
    }
    return names.sort();
  } finally {
    await directory.close();
  }
}

function normalizedName(name: string): string {
  const normalized = name.normalize("NFC");
  try {
    return decodeURIComponent(normalized).normalize("NFC").toLowerCase();
  } catch {
    return normalized.toLowerCase();
  }
}

function splitName(name: string): { stem: string; extension: string } {
  const dot = name.lastIndexOf(".");
  return dot > 0
    ? { stem: name.slice(0, dot), extension: name.slice(dot + 1) }
    : { stem: name, extension: "" };
}

function sortedTokens(stem: string): string {
  // Keep empty tokens so replacing separators preserves the length prefilter.
  return stem
    .split(/[\s\p{P}]/u)
    .sort()
    .join(" ");
}

function similarNames(requested: string, names: Array<string>): Array<string> {
  const request = splitName(normalizedName(requested));
  const entries = names.flatMap((name) =>
    name === requested ? [] : [{ name, ...splitName(normalizedName(name)) }],
  );
  // Every eligible first comparison is mandatory. Refuse an over-budget
  // directory before spending cells on results that must be discarded.
  const minimumCells = entries.reduce(
    (total, entry) => total + distanceCells(request.stem, entry.stem),
    0,
  );
  if (minimumCells > SCORING_CELL_BUDGET) return [];
  const budget = { remaining: SCORING_CELL_BUDGET };
  const candidates: Array<{ name: string; score: number }> = [];
  for (const candidate of entries) {
    const penalty = request.extension === candidate.extension ? 0 : 0.1;
    let score = similarity(request.stem, candidate.stem, budget) - penalty;
    if (
      score < MIN_SIMILARITY &&
      Math.min(request.stem.length, candidate.stem.length) >= 3
    ) {
      score =
        similarity(
          sortedTokens(request.stem),
          sortedTokens(candidate.stem),
          budget,
        ) - penalty;
    }
    if (budget.remaining < 0) return [];
    if (score >= MIN_SIMILARITY)
      candidates.push({ name: candidate.name, score });
  }
  // Stable sorting retains the directory's name order for equal scores.
  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ name }) => name);
}

function similarity(
  left: string,
  right: string,
  budget: { remaining: number },
): number {
  if (left === right) return 1;
  const cells = distanceCells(left, right);
  if (cells === 0) return 0;
  budget.remaining -= cells;
  if (budget.remaining < 0) return 0;
  return (
    1 - damerauLevenshtein(left, right) / Math.max(left.length, right.length)
  );
}

function distanceCells(left: string, right: string): number {
  return left === right ||
    Math.min(left.length, right.length) < 3 ||
    Math.abs(left.length - right.length) >
      Math.max(left.length, right.length) / 2
    ? 0
    : left.length * right.length;
}

/** Unrestricted Damerau-Levenshtein: a transposed character may be edited again. */
function damerauLevenshtein(left: string, right: string): number {
  const width = right.length + 2;
  const distance = new Uint16Array((left.length + 2) * width);
  const infinity = left.length + right.length;
  distance[0] = infinity;
  for (let row = 0; row <= left.length; row++) {
    distance[(row + 1) * width] = infinity;
    distance[(row + 1) * width + 1] = row;
  }
  for (let column = 0; column <= right.length; column++) {
    distance[column + 1] = infinity;
    distance[width + column + 1] = column;
  }
  const lastRow = new Map<string, number>();
  for (let row = 1; row <= left.length; row++) {
    let lastColumn = 0;
    for (let column = 1; column <= right.length; column++) {
      const priorRow = lastRow.get(right[column - 1]) ?? 0;
      const priorColumn = lastColumn;
      const equal = left[row - 1] === right[column - 1];
      if (equal) lastColumn = column;
      distance[(row + 1) * width + column + 1] = Math.min(
        distance[row * width + column] + (equal ? 0 : 1),
        distance[(row + 1) * width + column] + 1,
        distance[row * width + column + 1] + 1,
        distance[priorRow * width + priorColumn] +
          row -
          priorRow +
          column -
          priorColumn -
          1,
      );
    }
    lastRow.set(left[row - 1], row);
  }
  return distance[(left.length + 1) * width + right.length + 1];
}
