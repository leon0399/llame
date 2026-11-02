/**
 * The read-time finding re-check (tool-result-artifacts D5).
 *
 * A `grep` or `web_search` artifact records one finding for each file, result,
 * or answer it holds: the source locators the producer admitted, the rule that
 * admitted them, and the artifact line range of the whole entry, heading line
 * included. `read` evaluates the current `read` group over the findings the
 * served lines touch, and a refused finding's lines render as `[withheld]`
 * with every line number unchanged.
 *
 * The re-check is the sixth named permission exception: it records no decision,
 * counts no refused file for the completion audit, and a `bypass` attempt
 * evaluates nothing.
 */

import {
  splitSourceLines,
  type ReadTarget,
} from '@workspace/native-file-tools';
import { isNumber, isRecord, isString } from '@workspace/runtime-safety';

import { admitPermission, type PermissionContext } from '../permissions/admit';
import { nativeFileProjection } from '../permissions/locator-projection';
import { type ToolContext } from '../types';
import { evaluateWebLocatorRead } from '../web-read/admission';

/** The document version a writer stamps; a reader accepts no other. */
const FINDINGS_VERSION = 1;
/** A part's finding list, its locators, and one locator's length are bounded. */
const MAX_FINDINGS = 20_000;
const MAX_LOCATORS = 200;
const MAX_LOCATOR_LENGTH = 2048;

const WITHHELD_LINE = '[withheld]';

/**
 * The producer's admission rule. `allow_only` withholds unless the `read`
 * group allows the locator, which is what admitted a `grep` file; `reject_only`
 * withholds only when a reject clause matches, which is what removed a
 * `web_search` result.
 */
export type FindingRule = 'allow_only' | 'reject_only';

export type ArtifactFinding = {
  /** The source locators this entry came from; an answer lists its citations. */
  readonly locators: ReadonlyArray<string>;
  readonly rule: FindingRule;
  /** The first artifact line of the entry, heading line included. */
  readonly start: number;
  /** The last artifact line of the entry, inclusive. */
  readonly end: number;
};

export type ArtifactFindings = {
  readonly version: typeof FINDINGS_VERSION;
  readonly findings: ReadonlyArray<ArtifactFinding>;
};

/** The document a producer stores on its part. */
export function artifactFindings(
  findings: ReadonlyArray<ArtifactFinding>,
): ArtifactFindings {
  return { version: FINDINGS_VERSION, findings };
}

/**
 * A stored part's finding document, or `undefined` when it is not one this
 * build wrote. Stored jsonb is untrusted on the way back in.
 */
export function parseArtifactFindings(
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- the boundary parser for the part's untrusted `findings` jsonb column; every field is checked before the document is trusted.
  value: unknown,
): ArtifactFindings | undefined {
  if (!isRecord(value) || value['version'] !== FINDINGS_VERSION) {
    return undefined;
  }
  const findings = value['findings'];
  if (!Array.isArray(findings) || findings.length > MAX_FINDINGS) {
    return undefined;
  }
  const parsed: Array<ArtifactFinding> = [];
  for (const entry of findings) {
    const finding = parseFinding(entry);
    if (finding === undefined) return undefined;
    parsed.push(finding);
  }
  return { version: FINDINGS_VERSION, findings: parsed };
}

function parseFinding(value: unknown): ArtifactFinding | undefined {
  if (!isRecord(value)) return undefined;
  const rule = value['rule'];
  const start = value['start'];
  const end = value['end'];
  const locators = value['locators'];
  if (
    !isFindingRule(rule) ||
    !isLineNumber(start) ||
    !isLineNumber(end) ||
    end < start ||
    !Array.isArray(locators) ||
    locators.length === 0 ||
    locators.length > MAX_LOCATORS ||
    !locators.every(isLocatorText)
  ) {
    return undefined;
  }
  return { locators, rule, start, end };
}

function isFindingRule(value: unknown): value is FindingRule {
  return value === 'allow_only' || value === 'reject_only';
}

function isLocatorText(value: unknown): value is string {
  return (
    isString(value) && value.length > 0 && value.length <= MAX_LOCATOR_LENGTH
  );
}

function isLineNumber(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= 1;
}

/** The context fields the re-check reads; the reader passes its whole one. */
export type FindingContext = PermissionContext &
  Pick<ToolContext, 'workspaceRoot'>;

/** The finding record of a stored part, as the reader sees it. */
export type FindingPart = {
  readonly findings: unknown;
  readonly contentType: string;
};

/**
 * The part's text with every refused finding's lines replaced by
 * `[withheld]`. A part with no finding record is returned unchanged, and no
 * policy is consulted for it; a record this build cannot parse fails closed by
 * withholding every line.
 */
export function withholdFindings(
  context: FindingContext,
  part: FindingPart,
  text: string,
  resolved: ReadTarget,
): string {
  if (part.findings === null || part.findings === undefined) return text;
  const lines = splitSourceLines(text);
  const withheld = withheldLines(context, part, resolved, lines.length);
  if (withheld.size === 0) return text;
  return lines
    .map((line, index) =>
      withheld.has(index + 1)
        ? line.endsWith('\n')
          ? `${WITHHELD_LINE}\n`
          : WITHHELD_LINE
        : line,
    )
    .join('');
}

/** The 1-based artifact lines this read withholds. */
function withheldLines(
  context: FindingContext,
  part: FindingPart,
  resolved: ReadTarget,
  lineCount: number,
): Set<number> {
  const withheld = new Set<number>();
  const document = parseArtifactFindings(part.findings);
  if (document === undefined) {
    // A record this build cannot read names no range to keep, so the part
    // fails closed: a policy tightening must never reveal more than it did.
    for (let line = 1; line <= lineCount; line += 1) withheld.add(line);
    return withheld;
  }

  const window = servedWindow(resolved, lineCount);
  const reachStart =
    part.contentType === 'text/markdown' && !resolved.raw && window.start > 1
      ? 1
      : window.start;
  const verdicts = new Map<string, boolean>();
  for (const finding of document.findings) {
    const served =
      reachStart <= window.end &&
      finding.start <= window.end &&
      finding.end >= reachStart;
    if (!served || !withheldFinding(context, finding, verdicts)) continue;
    for (
      let line = Math.max(1, finding.start);
      line <= Math.min(lineCount, finding.end);
      line += 1
    ) {
      withheld.add(line);
    }
  }
  return withheld;
}

/** A 1-based artifact line window, both ends inclusive. */
type LineWindow = { readonly start: number; readonly end: number };

/**
 * The artifact lines a read can serve: the requested window, or the whole
 * text when the selector leaves it open. A comma request uses the grown
 * windows the reader actually reads.
 */
function servedWindow(resolved: ReadTarget, lineCount: number): LineWindow {
  if (resolved.ranges !== undefined) {
    const ranges = resolved.expandedRanges ?? resolved.ranges;
    const first = ranges.at(0);
    const last = ranges.at(-1);
    if (first === undefined || last === undefined) return { start: 1, end: 0 };
    return {
      start: first.offset + 1,
      end: Math.min(lineCount, last.offset + last.limit),
    };
  }
  return {
    start: resolved.offset + 1,
    end: Math.min(lineCount, resolved.offset + (resolved.limit ?? lineCount)),
  };
}

/** Whether one finding is refused by the rule that admitted it. */
function withheldFinding(
  context: FindingContext,
  finding: ArtifactFinding,
  verdicts: Map<string, boolean>,
): boolean {
  return finding.locators.some((locator) =>
    withheldLocator(context, finding.rule, locator, verdicts),
  );
}

function withheldLocator(
  context: FindingContext,
  rule: FindingRule,
  locator: string,
  verdicts: Map<string, boolean>,
): boolean {
  const key = `${rule}\0${locator}`;
  const known = verdicts.get(key);
  if (known !== undefined) return known;
  const withdrawn =
    context.permissionMode === 'bypass'
      ? false
      : rule === 'allow_only'
        ? !allowsLocator(context, locator)
        : rejectsLocator(context, locator);
  verdicts.set(key, withdrawn);
  return withdrawn;
}

/** A `grep` finding stays visible only on an allow, as the file was admitted. */
function allowsLocator(context: FindingContext, locator: string): boolean {
  const project = nativeFileProjection(
    'read',
    context.workspaceRoot?.current(),
  );
  const decision = admitPermission(context, (evaluate) =>
    evaluate({
      toolId: 'read',
      args: { path: locator },
      projectFieldValue: project,
    }),
  );
  return decision?.decision === 'allow';
}

/** A `web_search` finding stays visible unless a reject clause matches. */
function rejectsLocator(context: FindingContext, locator: string): boolean {
  const decision = evaluateWebLocatorRead(context, locator);
  return (
    decision?.decision === 'reject' && decision.reference?.clauseIndex != null
  );
}
