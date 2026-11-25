import { randomUUID } from 'node:crypto';
import {
  measureEditRendering,
  splitSourceLines,
  MAX_RESULT_CODE_UNITS,
} from '@workspace/native-file-tools';
import type {
  NativeFailureResult,
  Replaced,
  Written,
} from '@workspace/machine-protocol';
import { WriteMode } from '@workspace/machine-protocol';
import type { Handler } from './index.js';
import type {
  MachineRequestOptions,
  MachineSession,
} from '../machine-session.js';
import { failure, isNativeFailure, renderPath, rpc } from './files-common.js';
import { readRange } from './files-read.js';

type EditMutation = {
  status: 'success';
  operation: 'edit';
  path: string;
  replacements: 1;
  lineCount: number;
  content: string;
  shownRange: { startLine: number; endLine: number } | null;
  truncated: boolean;
  display: { startLine: number; oldText: string; newText: string };
};

type EditMutationInput = {
  path: string;
  displayPrefix: string;
  oldText: string;
  newText: string;
  changed: Replaced;
  startLine: number;
  lines: Array<string>;
};

async function replaceText(
  session: MachineSession,
  params: Parameters<Handler<'fs.edit'>>[1],
  options?: MachineRequestOptions,
): Promise<Replaced | NativeFailureResult> {
  const response = await rpc(
    session,
    (files, callOptions) =>
      files.replaceText(
        {
          requestId: randomUUID(),
          path: params.path,
          oldText: params.oldText,
          newText: params.newText,
        },
        callOptions,
      ),
    options,
  );

  if (response.result.case === 'failure') {
    return (
      failure(response.result.value) ?? {
        status: 'error',
        type: 'executor_unavailable',
        message: 'Text replacement failed.',
      }
    );
  }

  if (response.result.case !== 'replaced') {
    throw new Error('Text replacement response did not contain a result.');
  }

  return response.result.value;
}

function trimEditMutation(
  mutation: EditMutation,
  reserveCodeUnits: number,
): EditMutation {
  const maxUnits = Math.min(MAX_RESULT_CODE_UNITS - reserveCodeUnits, 16_000);

  while (
    measureEditRendering(mutation) > maxUnits &&
    mutation.content.length > 0
  ) {
    const previousLine = mutation.content.lastIndexOf(
      '\n',
      mutation.content.length - 2,
    );

    mutation.content =
      previousLine < 0 ? '' : mutation.content.slice(0, previousLine + 1);

    if (mutation.shownRange !== null) {
      const endLine =
        mutation.content.split('\n').length + mutation.shownRange.startLine - 2;

      mutation.shownRange =
        endLine < mutation.shownRange.startLine
          ? null
          : { ...mutation.shownRange, endLine };
    }

    mutation.truncated = true;
  }

  return mutation;
}

function buildEditMutation(input: EditMutationInput): EditMutation {
  const { path, displayPrefix, oldText, newText, changed, startLine, lines } =
    input;

  return {
    status: 'success',
    operation: 'edit',
    path: renderPath(path, displayPrefix),
    replacements: 1,
    lineCount: changed.lineCount,
    content: lines
      .map((line, index) => `${startLine + index}: ${line}\n`)
      .join(''),
    shownRange:
      lines.length === 0
        ? null
        : { startLine, endLine: startLine + lines.length - 1 },
    truncated: false,
    display: { startLine: changed.startLine, oldText, newText },
  };
}

export const editHandler: Handler<'fs.edit'> = async (
  session,
  params,
  options,
) => {
  const changed = await replaceText(session, params, options);

  if (isNativeFailure(changed)) return changed;

  const startLine = Math.max(1, changed.startLine - 2);

  const source = await readRange(
    session,
    {
      path: params.path,
      start: startLine,
      limit: splitSourceLines(params.newText).length + 4,
    },
    options,
  );

  const lines = isNativeFailure(source) ? [] : source.lines;

  const mutation = buildEditMutation({
    path: params.path,
    displayPrefix: params.options.displayPrefix,
    oldText: params.oldText,
    newText: params.newText,
    changed,
    startLine,
    lines,
  });

  return trimEditMutation(mutation, params.options.reserveCodeUnits ?? 0);
};

async function writeFile(
  session: MachineSession,
  params: Parameters<Handler<'fs.write'>>[1],
  options?: MachineRequestOptions,
): Promise<Written | NativeFailureResult> {
  const encoded = new TextEncoder().encode(params.content);
  const content = new Uint8Array(encoded.length);
  content.set(encoded);

  const response = await rpc(
    session,
    (files, callOptions) =>
      files.writeFile(
        {
          requestId: randomUUID(),
          path: params.path,
          content,
          mode: params.replace === true ? WriteMode.REPLACE : WriteMode.CREATE,
          createParents: true,
        },
        callOptions,
      ),
    options,
  );

  if (response.result.case === 'failure') {
    return (
      failure(response.result.value) ?? {
        status: 'error',
        type: 'executor_unavailable',
        message: 'File write failed.',
      }
    );
  }

  if (response.result.case !== 'written') {
    throw new Error('File write response did not contain a result.');
  }

  return response.result.value;
}

export const writeHandler: Handler<'fs.write'> = async (
  session,
  params,
  options,
) => {
  const written = await writeFile(session, params, options);

  if (isNativeFailure(written)) return written;

  const result = {
    status: 'success' as const,
    operation: 'write' as const,
    path: renderPath(params.path, params.options.displayPrefix),
    lineCount: splitSourceLines(params.content).length,
  };

  return written.created
    ? { ...result, created: true as const }
    : { ...result, replaced: true as const };
};
