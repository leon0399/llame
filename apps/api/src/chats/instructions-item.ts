/**
 * The `instructions` producer (workspace instruction files D8).
 *
 * One item per model step, or accepted turn, whose triggers loaded at least
 * one per-directory instruction file. The caller owns the bundle — the walk,
 * the candidate selection, the reads, and the order — and this module owns
 * the payload (the selected paths, their canonical seen keys, the truncation
 * flags, and the privately recorded denials) and the model-visible body.
 *
 * Producer discipline follows the rail's: the envelope, its provenance line,
 * and the escaping of its own attributes belong to `context-item.ts`. A
 * repository-authored body is neutralized with `sanitizeAuthoredText` before
 * it is composed here, so a body cannot close the `<file>` element it sits in
 * or forge another envelope.
 */

import { sanitizeAuthoredText } from '../instance-config/authored-text';
import { loadPackagedTemplate } from '../prompts/template-engine';
import { isBoolean, type UnknownRecord } from '@workspace/runtime-safety';

import {
  escapeXmlAttribute,
  isContextItemPart,
  type AuthoredContextItemPart,
} from './context-item';
import {
  createRenderedContextItem,
  isExactRecord,
  isNonEmptyString,
} from './context-item-shared';

/** One file the caller loaded, with the reader's truncation bookkeeping. */
export interface LoadedInstructionFile {
  /** The absolute path at which the candidate was selected in the walk. */
  readonly path: string;
  /** The loaded file's `realpath`: the seen-set key, never rendered. */
  readonly canonicalPath: string;
  readonly content: string;
  readonly truncated: boolean;
  /** Bytes the 32 KiB cut left out, taken from the probed size. */
  readonly omittedBytes: number;
}

export type InstructionsPayloadFile = Pick<
  LoadedInstructionFile,
  'path' | 'canonicalPath' | 'truncated'
>;

/**
 * The item's metadata. `denied` is owner-only: a denial is operator policy the
 * model can act on in no useful way, and naming the path invites a retry that
 * is denied again, so it never reaches `data.text`.
 */
export interface InstructionsPayload extends UnknownRecord {
  readonly files: ReadonlyArray<InstructionsPayloadFile>;
  readonly denied: ReadonlyArray<string>;
}

export function isInstructionsPayload(
  value: unknown,
): value is InstructionsPayload {
  if (!isExactRecord(value, ['files', 'denied'])) return false;
  const files = value['files'];
  const denied = value['denied'];
  return (
    Array.isArray(files) &&
    // A bundle exists only because a trigger loaded a file; an empty one would
    // claim a disclosure that never happened.
    files.length > 0 &&
    files.every(isInstructionsPayloadFile) &&
    Array.isArray(denied) &&
    denied.every(isNonEmptyString)
  );
}

function isInstructionsPayloadFile(
  value: unknown,
): value is InstructionsPayloadFile {
  return (
    isExactRecord(value, ['path', 'canonicalPath', 'truncated']) &&
    isNonEmptyString(value['path']) &&
    isNonEmptyString(value['canonicalPath']) &&
    isBoolean(value['truncated'])
  );
}

/**
 * One bundle: the loaded files in the caller's order (broadest directory
 * first, a directory's base file before its local file).
 */
export function createInstructionsItem(input: {
  readonly runId: string;
  readonly files: ReadonlyArray<LoadedInstructionFile>;
  readonly denied: ReadonlyArray<string>;
}): AuthoredContextItemPart {
  const payload: InstructionsPayload = {
    files: input.files.map((file) => ({
      path: file.path,
      canonicalPath: file.canonicalPath,
      truncated: file.truncated,
    })),
    denied: [...input.denied],
  };
  // oxlint-disable-next-line anti-slop/no-known-value-widening -- the declared type cannot express the invariants this guard enforces, so it is an assertion about the value, not a redundant re-parse of a type we already trust.
  if (!isInstructionsPayload(payload)) {
    throw new TypeError('Invalid server-authored instructions metadata');
  }
  return createRenderedContextItem({
    producer: 'instructions',
    form: 'notice',
    runId: input.runId,
    payload,
    body: renderInstructions(input.files),
  });
}

const renderInstructionsTemplate = loadPackagedTemplate<{
  readonly files: ReadonlyArray<{
    readonly path: string;
    readonly body: string;
    readonly truncated: boolean;
    readonly omittedBytes: number;
  }>;
}>(__dirname, 'instructions');

function renderInstructions(
  files: ReadonlyArray<LoadedInstructionFile>,
): string {
  return renderInstructionsTemplate({
    files: files.map((file) => ({
      // The path labels the block, so it is attribute-escaped; the body is
      // repository-authored text sitting inside an element of its own. The
      // sanitizer keeps it from closing that element or opening another
      // envelope. A body that spells a tag-shaped `file` token — a balanced
      // forged block, or an unmatched opener the template's own closer would
      // end — is neutralized on top of that, so it cannot forge a block
      // labelled with a path that was never loaded. `file` stays out of the
      // shared reserved set because reserving it globally would strip the tag
      // from every operator prompt; the `<` is escaped rather than the token
      // dropped, keeping the body readable.
      path: escapeXmlAttribute(file.path),
      body: sanitizeAuthoredText(file.content).replaceAll(
        /<(\s*\/?\s*file)(?=\s*\/?>|[\s/]+[\w-]+\s*=|$)/gi,
        '&lt;$1',
      ),
      truncated: file.truncated,
      omittedBytes: file.omittedBytes,
    })),
  });
}

/**
 * The canonical paths named in the `files` payload of every `instructions`
 * item among `parts` (any message role). This is the whole seen set: it is
 * derived from effective history, so it survives a fork through copied
 * messages and is discarded by compaction along with the item that carried it.
 */
export function instructionsSeenPaths(parts: Iterable<unknown>): Set<string> {
  const seen = new Set<string>();
  for (const part of parts) {
    if (!isContextItemPart(part) || part.data.producer !== 'instructions') {
      continue;
    }
    if (!isInstructionsPayload(part.data.payload)) continue;
    for (const file of part.data.payload.files) {
      seen.add(file.canonicalPath);
    }
  }
  return seen;
}
