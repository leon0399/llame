/**
 * The model-facing part of a `grep` call (tool-result-artifacts D3, D7): the
 * whole result is rendered into `artifact://grep-<n>` and the inline part is
 * the head of that text under the tool's own bound.
 *
 * The inline part is a prefix of the artifact text, so every inline line keeps
 * its number in the artifact. The framing lines after the passages — warnings,
 * excluded directories, an unfinished file, the remainder, and the notice —
 * exist only inline; the artifact holds headings and passages. A Run that
 * cannot read the artifact keeps the head and counts what it left out.
 */

import {
  GREP_LIMITS,
  grepFileLocator,
  grepIgnoredUnits,
  grepLeftOutUnits,
  grepPassageBlockLines,
  grepPassageUnits,
  grepRemainderUnits,
  grepUnfinishedUnits,
  grepWarningsUnits,
  measureGrepRendering,
  passageEndLine,
  passageStartLine,
  type GrepPassage,
  type GrepRemainder,
} from '@workspace/native-file-tools';
import {
  artifactNotice,
  type ArtifactNoticeHostFiles,
} from '@workspace/runtime-safety';

import { KNOWLEDGE_CONTENT_NOTICE } from '../knowledge/knowledge-content-notice';
import { artifactFindings, type ArtifactFinding } from './artifacts/findings';
import { artifactLinePieceCount } from './artifacts/lines';
import { storeSinglePartArtifact, artifactHostFiles } from './artifacts/spill';
import { type WrittenArtifact } from './artifacts/artifact-writer';
import {
  grepArtifactBytes,
  grepArtifactFindings,
  grepArtifactHasNotice,
  grepArtifactText,
  ignoredReportOf,
  pageResult,
  type GrepArtifact,
  type PageState,
} from './grep-page';
import { type ToolContext, type ToolResult } from './types';

/**
 * The call's result: the whole result when it fits the inline bound, otherwise
 * the artifact plus its inline head. A Run that cannot read an artifact keeps
 * the head and states what it left out.
 */
export async function finishGrepCall(
  state: PageState,
  context: ToolContext,
  limit: number,
): Promise<ToolResult> {
  const artifact = state.artifact;
  // UTF-16 units are at least a third of the UTF-8 bytes, so a larger
  // artifact cannot fit and needs no render.
  const withinReach =
    grepArtifactBytes(artifact) <= 3 * GREP_LIMITS.pageCodeUnits;
  if (
    filesOf(artifact) <= limit &&
    withinReach &&
    measureGrepRendering(pageResult(state)) <= GREP_LIMITS.pageCodeUnits
  )
    return pageResult(state);
  const trailing = trailingUnits(state);
  const findings = grepArtifactFindings(artifact);
  const written = await storeGrepArtifact(state, context, findings);
  if (written === undefined) return leftOutResult(state, limit, trailing);
  return artifactResult({
    state,
    written,
    hostFiles: artifactHostFiles(context, 'grep', written),
    findings,
    limit,
    trailing,
  });
}

/**
 * The room the inline head keeps back for the left-out line. The line counts
 * at most a nine-digit number of files, results, or lines, which is wider than
 * any real sum, so the reserve is computed once.
 */
const LEFT_OUT_RESERVE = grepLeftOutUnits(999_999_999, 'results');

/** The inline result without an artifact: the head and what it left out. */
function leftOutResult(
  state: PageState,
  limit: number,
  trailing: number,
): ToolResult {
  const total = filesOf(state.artifact);
  const passages = state.artifact.results.length;
  const reserve = trailing + LEFT_OUT_RESERVE;
  const head = inlineHead(state.artifact, limit, reserve, false);
  const leftFiles = total - head.files;
  const leftPassages = passages - head.results.length;
  const leftOut =
    leftFiles > 0
      ? { count: leftFiles, of: 'files' as const }
      : head.cut !== undefined
        ? { count: head.cut, of: 'lines' as const }
        : leftPassages > 0
          ? { count: leftPassages, of: 'results' as const }
          : undefined;
  return {
    ...pageResult(state, head.results),
    ...(leftOut !== undefined && { leftOut }),
  };
}

/** The result of a stored artifact: its head, the remainder line, the notice. */
function artifactResult(input: {
  readonly state: PageState;
  readonly written: WrittenArtifact;
  readonly hostFiles: ArtifactNoticeHostFiles | undefined;
  readonly findings: ReadonlyArray<ArtifactFinding>;
  readonly limit: number;
  /** The rendered width of the framing lines after the passages. */
  readonly trailing: number;
}): ToolResult {
  const { state, written, hostFiles, findings, limit, trailing } = input;
  // The notice names the line after the head, so its digits are widest when
  // the head reaches the artifact's last line: keep that width back.
  const widest = storedNotice(written, hostFiles, written.lineCount + 1);
  const reserve = trailing + grepRemainderUnits() + widest.length + 3;
  const head = inlineHead(state.artifact, limit, reserve, true);
  const remainder = remainderAfter(state.artifact, findings, head);
  return {
    ...pageResult(state, head.results),
    artifact: written.locator,
    ...(remainder !== undefined && { remainder }),
    truncationNotice: storedNotice(written, hostFiles, head.artifactLines + 1),
  };
}

/** The one artifact notice, bracket-free: its renderer adds the pair. */
function storedNotice(
  written: WrittenArtifact,
  hostFiles: ArtifactNoticeHostFiles | undefined,
  next: number,
): string {
  return artifactNotice(
    [{ locator: written.locator, lines: written.lineCount }],
    {
      continueWith: { locator: written.locator, next },
      hostFiles,
    },
  ).slice(1, -1);
}

/** The inline head: whole passages of the artifact text while the next fits. */
type InlineHead = {
  readonly results: ReadonlyArray<GrepPassage>;
  /** The artifact-numbered lines the head occupies, the notice line included. */
  readonly artifactLines: number;
  /** The file runs the head holds. */
  readonly files: number;
  /** Source lines of the cut first passage the head does not hold. */
  readonly cut?: number;
};

/**
 * The head of the artifact text under the inline bound: whole passages in
 * result order while the next one fits, at most `limit` files, inside 15,000
 * code units once `reserve` keeps the framing lines' room back. When the first
 * passage does not fit, it is cut at a line boundary, or inside one line, and
 * `markCut` names the artifact that holds the rest.
 */
function inlineHead(
  artifact: GrepArtifact,
  limit: number,
  reserve: number,
  markCut: boolean,
): InlineHead {
  const budget = GREP_LIMITS.pageCodeUnits - reserve;
  const results: Array<GrepPassage> = [];
  const notice = grepArtifactHasNotice(artifact);
  // The notice line and its newline start the text, so they take their room
  // first.
  let used = notice ? `notice: ${KNOWLEDGE_CONTENT_NOTICE}`.length + 1 : 0;
  let files = 0;
  let artifactLines = notice ? 1 : 0;
  for (const [index, passage] of artifact.results.entries()) {
    const block = artifact.blocks[index];
    // The inline part holds at most `limit` files; a later file waits in the
    // artifact.
    if (block.newRun && files >= limit) break;
    const units = grepPassageUnits(results.at(-1), passage);
    if (used + units <= budget) {
      results.push(passage);
      used += units;
      artifactLines += block.pieces;
      if (block.newRun) files += 1;
      continue;
    }
    if (results.length === 0) {
      const cut = cutToInline(passage, budget - used, markCut);
      results.push(cut);
      artifactLines += blockPieces(cut);
      // A cut only ever happens as the first passage, which opens its file
      // run: the file is shown, so only its remaining lines are left out.
      files += 1;
      const left =
        passageEndLine(passage.locator) - passageEndLine(cut.locator);
      if (left > 0) return { results, artifactLines, files, cut: left };
    }
    break;
  }
  return { results, artifactLines, files };
}

/** The artifact-numbered lines one passage's block holds. */
function blockPieces(passage: GrepPassage): number {
  return grepPassageBlockLines(undefined, passage, false).reduce(
    (total, line) => total + artifactLinePieceCount(line),
    0,
  );
}

/**
 * The first `available` code units of a passage, as whole lines. A rendered
 * content line is at most the engine's 512-unit line cut, and the inline
 * reserve leaves thousands of units, so one whole line always fits: the floor
 * is that line, never a partial one. `markCut` records that the artifact holds
 * the rest; without an artifact nothing is marked, because nothing holds it.
 */
function cutToInline(
  passage: GrepPassage,
  available: number,
  markCut: boolean,
): GrepPassage {
  const start = passageStartLine(passage.locator);
  const end = passageEndLine(passage.locator);
  const lines = passage.content.replace(/\n$/u, '').split('\n');
  const cutAt = (last: number): GrepPassage => ({
    locator: `${fileOf(passage)}:${String(start)}-${String(last)}`,
    content: lines.slice(0, last - start + 1).join('\n'),
    matches: passage.matches.filter((match) => match <= last),
    ...(markCut && { cut: true as const }),
    ...(passage.truncated === true && { truncated: true as const }),
  });
  // The width only grows with more lines, so the largest fitting end is a
  // binary search, not one full render per line.
  let low = start;
  let high = end;
  let best: GrepPassage | undefined;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = cutAt(middle);
    if (grepPassageUnits(undefined, candidate) <= available) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  // One line is the floor: a match never yields an empty inline part.
  return best ?? cutAt(start);
}

/** The files the artifact lists, by run of consecutive passages. */
function filesOf(artifact: GrepArtifact): number {
  return artifact.blocks.filter((block) => block.newRun).length;
}

/** The file locator of a passage, its range removed. */
function fileOf(passage: GrepPassage): string {
  return grepFileLocator(passage.locator);
}

/** The rendered width of the framing lines after the passages. */
function trailingUnits(state: PageState): number {
  const ignored = ignoredReportOf(state);
  return (
    grepWarningsUnits(state.warnings) +
    (ignored === undefined ? 0 : grepIgnoredUnits(ignored)) +
    (state.unfinished === undefined ? 0 : grepUnfinishedUnits(state.unfinished))
  );
}

/** The remainder the artifact holds after the inline part. */
function remainderAfter(
  artifact: GrepArtifact,
  findings: ReadonlyArray<ArtifactFinding>,
  head: InlineHead,
): GrepRemainder | undefined {
  const next = findings.flatMap((finding) => {
    if (finding.end <= head.artifactLines) return [];
    return [
      {
        locator: finding.locators[0],
        start: Math.max(finding.start, head.artifactLines + 1),
        end: finding.end,
      },
    ];
  });
  if (next.length === 0) return undefined;
  return {
    files: next.length,
    // A cut first passage still leaves lines in the artifact, so its rest
    // counts as the passage that continues after the inline part.
    passages:
      artifact.results.length -
      head.results.length +
      (head.cut === undefined ? 0 : 1),
    next: next.slice(0, 10),
  };
}

/** Store the artifact text and its findings, or nothing at all. */
async function storeGrepArtifact(
  state: PageState,
  context: ToolContext,
  findings: ReadonlyArray<ArtifactFinding>,
): Promise<WrittenArtifact | undefined> {
  return await storeSinglePartArtifact(context, 'grep', {
    contentType: 'text/markdown',
    content: grepArtifactText(state.artifact),
    findings: artifactFindings(findings),
    complete: state.complete,
  });
}
