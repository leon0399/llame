import { NativeFileError } from '@workspace/native-file-tools';
import { type ToolErrorResult, type ToolResult } from './types';

export type NativeFileErrorType = ToolErrorResult['type'];

export type MessageRequest =
  | { kind: 'default' }
  | { kind: 'range'; start: number; end: number }
  | { kind: 'forward'; start: number }
  | { kind: 'tail'; count: number };

export function parseMessageRequest(selector?: string): MessageRequest {
  if (selector === undefined) return { kind: 'default' };
  const tail = /^:?-([mM])(\d+)$/u.exec(selector);

  if (tail) return { kind: 'tail', count: positiveInteger(tail[2]) };

  const match =
    /^:?[mM](?:(\d+)-(\d+)|(\d+)-[mM](\d+)|(\d+)\+(\d+)|(\d+)-|(\d+))$/u.exec(
      selector,
    );

  if (!match) throw new Error('invalid');

  if ((match[1] && match[2]) || (match[3] && match[4])) {
    const start = positiveInteger(match[1] ?? match[3]);
    const end = positiveInteger(match[2] ?? match[4]);

    if (end < start) throw new Error('invalid');

    return { kind: 'range', start, end };
  }

  if (match[5] && match[6]) {
    const start = positiveInteger(match[5]);
    const end = start + (positiveInteger(match[6]) - 1);

    if (!Number.isSafeInteger(end)) throw new Error('invalid');

    return { kind: 'range', start, end };
  }

  if (match[7]) return { kind: 'forward', start: positiveInteger(match[7]) };
  const seq = positiveInteger(match[8]);

  return { kind: 'range', start: seq, end: seq };
}

function positiveInteger(value: string | undefined): number {
  if (value === undefined) throw new Error('invalid');
  const number = Number(value);

  if (!Number.isSafeInteger(number) || number < 1) throw new Error('invalid');

  return number;
}

export function error(type: NativeFileErrorType, message: string): ToolResult {
  return { status: 'error', type, message };
}

export function nativeError(
  cause: unknown,
  fallback: NativeFileErrorType,
): ToolResult {
  if (cause instanceof NativeFileError) return error(cause.type, cause.message);

  return error(fallback, 'The Chat selector is invalid.');
}
