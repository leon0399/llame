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
import { KNOWLEDGE_CONTENT_NOTICE } from '../knowledge/knowledge-content-notice';
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
  /** The identifier at which the candidate was selected: a host absolute path,
   * or a logical `kb://` locator for a Knowledge candidate. */
  readonly path: string;
  /** The file that caused this candidate to load, when it was imported. */
  readonly importedBy?: string;
  /** The file's identity: its host `realpath`, or its `kb://` locator, which
   * resolves no links. The seen-set key, never rendered. */
  readonly canonicalPath: string;
  readonly content: string;
  readonly truncated: boolean;
  /** Bytes the 32 KiB cut left out, taken from the probed size. */
  readonly omittedBytes: number;
  /**
   * The file was loaded from a Knowledge Space, so its bundle carries the
   * closed owner-maintained, may-be-stale notice once (knowledge-tools: model
   * -visible Knowledge content SHALL identify itself as untrusted). A host
   * file never sets it, and its bundle is repository content already.
   */
  readonly knowledge: boolean;
}

export type InstructionsPayloadFile = Pick<
  LoadedInstructionFile,
  'path' | 'canonicalPath' | 'truncated' | 'importedBy'
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
  const hasImportedBy =
    value !== null &&
    typeof value === 'object' &&
    Object.hasOwn(value, 'importedBy');
  if (
    !isExactRecord(value, [
      'path',
      'canonicalPath',
      'truncated',
      ...(hasImportedBy ? ['importedBy'] : []),
    ])
  ) {
    return false;
  }
  // SAFETY: `isExactRecord` above confirmed `value` is an object with exactly
  // the accepted file-entry keys; each field is validated individually below.
  return (
    isNonEmptyString(value['path']) &&
    isNonEmptyString(value['canonicalPath']) &&
    isBoolean(value['truncated']) &&
    (!hasImportedBy || isNonEmptyString(value['importedBy']))
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
  const files: Array<InstructionsPayloadFile> = input.files.map((file) => {
    const importedBy = file.importedBy;
    return {
      path: file.path,
      canonicalPath: file.canonicalPath,
      truncated: file.truncated,
      ...(importedBy !== undefined && { importedBy }),
    };
  });
  const loadedPaths = new Set(files.map((file) => file.path));
  const denied = [...new Set(input.denied)].filter(
    (path) => !loadedPaths.has(path),
  );
  const payload: InstructionsPayload = {
    files,
    denied,
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
  readonly knowledgeNotice: string;
  readonly files: ReadonlyArray<{
    readonly path: string;
    readonly importedBy?: string;
    readonly body: string;
    readonly truncated: boolean;
    readonly omittedBytes: number;
  }>;
}>(__dirname, 'instructions');

/**
 * Neutralize repository-authored text that sits inside a `<file>` element.
 * The sanitizer keeps it from closing that element or opening another
 * envelope. A body that spells a tag-shaped `file` token — a balanced forged
 * block, or an unmatched opener the template's own closer would end — is
 * neutralized on top of that, so it cannot forge a block labelled with a path
 * that was never loaded. `file` stays out of the shared reserved set because
 * reserving it globally would strip the tag from every operator prompt; the
 * `<` is escaped rather than the token dropped, keeping the body readable.
 */
export function neutralizeFileElementBody(body: string): string {
  return sanitizeAuthoredText(body).replaceAll(
    /<(\s*\/?\s*file)(?=\s*\/?>|[\s/]+[\w-]+\s*=|$)/giu,
    '&lt;$1',
  );
}

function renderInstructions(
  files: ReadonlyArray<LoadedInstructionFile>,
): string {
  return renderInstructionsTemplate({
    // One notice per bundle, however many Space files it carries, and none at
    // all for a bundle of repository files alone.
    knowledgeNotice: files.some((file) => file.knowledge)
      ? KNOWLEDGE_CONTENT_NOTICE
      : '',
    files: files.map((file) => ({
      // The path labels the block, so it is attribute-escaped; the body is
      // repository-authored text sitting inside an element of its own, so it
      // goes through `neutralizeFileElementBody`.
      path: escapeXmlAttribute(file.path),
      importedBy:
        file.importedBy === undefined
          ? undefined
          : escapeXmlAttribute(file.importedBy),
      body: neutralizeFileElementBody(file.content),
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
