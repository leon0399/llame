/**
 * The model-facing part of a `grep` call (tool-result-artifacts D3, D7): the
 * whole result is rendered as it walks into `artifact://grep-<n>`, and the
 * inline part is the head of that text under the tool's own bound.
 *
 * The inline part is a prefix of the artifact text, so every inline line keeps
 * its number in the artifact. The framing lines after the passages — warnings,
 * excluded directories, an unfinished file, the remainder, and the notice —
 * exist only inline; the artifact holds headings and passages. A Run that
 * cannot read the artifact keeps the head and counts the files it left out.
 */

import {
  GREP_LIMITS,
  grepFileLocator,
  grepIgnoredUnits,
  grepPassageBlockLines,
  grepPassageContinues,
  grepPassageUnits,
  grepUnfinishedUnits,
  grepWarningsUnits,
  measureGrepRendering,
  passageEndLine,
  passageStartLine,
  type GrepPassage,
} from '@workspace/native-file-tools';

import { KNOWLEDGE_CONTENT_NOTICE } from '../knowledge/knowledge-content-notice';
import { DEFAULT_ARTIFACT_MAX_BYTES } from '../instance-config/llame-config';
import { machineWorkspaceRoot } from './workspace-path';
import { artifactFindings, type ArtifactFinding } from './artifacts/findings';
import {
  writeToolArtifact,
  type WrittenArtifact,
} from './artifacts/artifact-writer';
import { artifactLineCount } from './artifacts/lines';
import { canReadArtifacts } from './artifacts/readable';
import {
  grepArtifactFindings,
  grepArtifactHasNotice,
  grepArtifactText,
  ignoredReportOf,
  pageResult,
  type GrepArtifact,
  type PageState,
} from './grep-page';
import { type ToolContext, type ToolResult } from './types';

/** One call's result assembly, after the walk stopped. */
export type GrepFinish = {
  readonly state: PageState;
  readonly context: ToolContext;
  /** The most files the inline part holds (`limit`, 1 to 20). */
  readonly limit: number;
};

/**
 * The call's result: the whole result when it fits the inline bound, otherwise
 * the artifact plus its inline head. A Run that cannot read an artifact keeps
 * the head and states how many files it left out.
 */
export async function finishGrepCall(finish: GrepFinish): Promise<ToolResult> {
  const { state, context, limit } = finish;
  const whole = pageResult(state);
  if (
    filesOf(state.artifact.results) <= limit &&
    measureGrepRendering(whole) <= GREP_LIMITS.pageCodeUnits
  )
    return whole;
  const trailing = trailingUnits(state);
  if (!canReadArtifacts(context, 'grep'))
    return leftOutResult(state, limit, trailing);
  const findings = grepArtifactFindings(state.artifact);
  const written = await storeGrepArtifact(state, context, findings);
  if (written === undefined) return leftOutResult(state, limit, trailing);
  return artifactResult({ state, context, limit, written, findings, trailing });
}

/** The inline result without an artifact: the head and its left-out count. */
function leftOutResult(
  state: PageState,
  limit: number,
  trailing: number,
): ToolResult {
  const total = filesOf(state.artifact.results);
  // The line counts files, or passages when no whole file is left out; keep
  // room for the wider of the two.
  const reserve =
    trailing +
    1 +
    Math.max(
      `[left out: ${String(total)} files; full result not stored]`.length,
      `[left out: ${String(state.artifact.results.length)} passages; full result not stored]`
        .length,
    );
  const head = inlineHead(state.artifact, limit, reserve, false);
  const leftFiles = total - filesOf(head.results);
  const leftPassages = state.artifact.results.length - head.results.length;
  const leftOut =
    leftFiles > 0
      ? { count: leftFiles, of: 'files' as const }
      : leftPassages > 0
        ? { count: leftPassages, of: 'passages' as const }
        : undefined;
  return {
    ...pageResult(state, head.results),
    ...(leftOut !== undefined && { leftOut }),
  };
}

/** The result of a stored artifact: its head, the remainder line, the notice. */
function artifactResult(input: {
  readonly state: PageState;
  readonly context: ToolContext;
  readonly limit: number;
  readonly written: WrittenArtifact;
  readonly findings: ReadonlyArray<ArtifactFinding>;
  /** The rendered width of the framing lines after the passages. */
  readonly trailing: number;
}): ToolResult {
  const { state, context, limit, written, findings, trailing } = input;
  const suffix = hostFilesSuffix(context, written);
  // The notice names the line after the head, so its digits are widest when
  // the head reaches the artifact's last line: keep that width back.
  const reserve =
    trailing +
    REMAINDER_LINE_RESERVE +
    grepNotice(written, written.lineCount + 1, suffix).length +
    3;
  const head = inlineHead(state.artifact, limit, reserve, true);
  const remainder = remainderAfter(state.artifact, findings, head);
  return {
    ...pageResult(state, head.results),
    artifact: written.locator,
    ...(remainder !== undefined && { remainder }),
    truncationNotice: grepNotice(written, head.artifactLines + 1, suffix),
  };
}

/** The most code units the remainder line may take, and its newline. */
const REMAINDER_LINE_RESERVE = 2001;

/** One `[full result: …]` notice, without its brackets. */
function grepNotice(
  written: WrittenArtifact,
  next: number,
  suffix: string,
): string {
  const lines =
    written.lineCount === 1 ? '1 line' : `${String(written.lineCount)} lines`;
  return `full result: ${written.locator} (${lines}); continue with ${written.locator}:${String(next)}-${suffix}`;
}

/** The host-file clause of the notice, when the writer made files (D10). */
function hostFilesSuffix(
  context: ToolContext,
  written: WrittenArtifact,
): string {
  const files = written.hostFiles;
  if (files === undefined) return '';
  return machineWorkspaceRoot(context.workspaceRoot?.current()) !== undefined
    ? '; host files on the llame host only'
    : `; host files in ${files.directory}`;
}

/** The inline head: whole passages of the artifact text while the next fits. */
type InlineHead = {
  readonly results: ReadonlyArray<GrepPassage>;
  /** The artifact-numbered lines the head occupies, the notice line included. */
  readonly artifactLines: number;
};

/**
 * The head of the artifact text under the inline bound: whole passages in
 * result order while the next one fits, at most `limit` files, inside 15,000
 * code units once `reserve` keeps the framing lines' room back. When the first
 * passage does not fit, it is cut at a line boundary and marked `cut`.
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
  // The notice line starts the text, so it takes its own room first.
  let used = notice ? `notice: ${KNOWLEDGE_CONTENT_NOTICE}`.length : 0;
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
    }
    break;
  }
  return { results, artifactLines };
}

/** The artifact-numbered lines one passage's block holds. */
function blockPieces(passage: GrepPassage): number {
  return grepPassageBlockLines(undefined, passage, false).reduce(
    (total, line) => total + artifactLineCount(line),
    0,
  );
}

/**
 * The first `available` code units of a passage, as whole lines with one
 * match line as the floor. `markCut` records that the artifact holds the rest;
 * without an artifact the passage is not marked, because nothing holds it.
 */
function cutToInline(
  passage: GrepPassage,
  available: number,
  markCut: boolean,
): GrepPassage {
  const start = passageStartLine(passage.locator);
  const end = passageEndLine(passage.locator);
  const file = grepFileLocator(passage.locator);
  const lines = passage.content.replace(/\n$/u, '').split('\n');
  const cutAt = (line: number): GrepPassage => ({
    locator: `${file}:${String(start)}-${String(line)}`,
    content: lines.slice(0, line - start + 1).join('\n'),
    matches: passage.matches.filter((match) => match <= line),
    ...(markCut && { cut: true as const }),
    ...(passage.truncated === true && { truncated: true as const }),
  });
  for (let line = end; line > start; line -= 1) {
    const cut = cutAt(line);
    if (grepPassageUnits(undefined, cut) <= available) return cut;
  }
  // One line is the floor: a match never yields an empty inline part.
  return cutAt(start);
}

/** The files the result lists, by run of consecutive passages. */
function filesOf(results: ReadonlyArray<GrepPassage>): number {
  let files = 0;
  for (const [index, passage] of results.entries()) {
    if (index === 0 || !grepPassageContinues(results[index - 1], passage))
      files += 1;
  }
  return files;
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
):
  | {
      readonly files: number;
      readonly passages: number;
      readonly next: ReadonlyArray<{
        readonly locator: string;
        readonly start: number;
        readonly end: number;
      }>;
    }
  | undefined {
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
    passages: artifact.results.length - head.results.length,
    next: next.slice(0, 10),
  };
}

/** Store the artifact text and its findings, or nothing at all. */
async function storeGrepArtifact(
  state: PageState,
  context: ToolContext,
  findings: ReadonlyArray<ArtifactFinding>,
): Promise<WrittenArtifact | undefined> {
  const { runId, toolCallId, userId, chatId } = context;
  if (runId === undefined || toolCallId === undefined) return undefined;
  try {
    return await writeToolArtifact(
      context.tenantDb,
      {
        chatId,
        userId,
        runId,
        toolCallId,
        toolName: 'grep',
        complete: state.complete,
        parts: [
          {
            contentType: 'text/markdown',
            content: Buffer.from(grepArtifactText(state.artifact), 'utf8'),
            findings: artifactFindings(findings),
          },
        ],
      },
      {
        maxBytes: context.artifactMaxBytes ?? DEFAULT_ARTIFACT_MAX_BYTES,
        hostFiles: context.artifactHostFiles === true,
      },
    );
  } catch {
    return undefined;
  }
}
