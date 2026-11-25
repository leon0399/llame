import type { CallOptions } from '@connectrpc/connect';
import type {
  FileFailure,
  NativeFailureResult,
} from '@workspace/machine-protocol';
import { FileFailureReason, EntryKind } from '@workspace/machine-protocol';
import type {
  MachineRequestOptions,
  MachineSession,
} from '../machine-session.js';

export const MAX_TREE_ENTRIES = 10_000;
export const READ_WINDOW_LINES = 2000;

const nativeFailureTypes = [
  'invalid_path',
  'invalid_selector',
  'not_found',
  'not_regular_file',
  'invalid_utf8',
  'invalid_input',
  'file_exists',
  'old_text_not_found',
  'old_text_ambiguous',
  'outcome_unknown',
  'executor_unavailable',
  'directory_too_large',
  'representation_too_large',
  'media_too_large',
  'unsupported_media_type',
] satisfies Array<NativeFailureResult['type']>;

export function isNativeFailureType(
  value: unknown,
): value is NativeFailureResult['type'] {
  return nativeFailureTypes.some((type) => type === value);
}

export function isNativeFailure(value: unknown): value is NativeFailureResult {
  return (
    value instanceof Object && 'status' in value && value.status === 'error'
  );
}

type FileRpc<T> = (
  files: MachineSession['clients']['files'],
  options: CallOptions,
) => T | Promise<T>;

export async function rpc<T>(
  session: MachineSession,
  invoke: FileRpc<T>,
  options?: MachineRequestOptions,
): Promise<T> {
  try {
    return await invoke(session.clients.files, session.callOptions(options));
  } catch (error) {
    throw session.mapRefusal(error);
  }
}

const failureTypes: Partial<
  Record<FileFailureReason, NativeFailureResult['type']>
> = {
  [FileFailureReason.NOT_FOUND]: 'not_found',
  [FileFailureReason.WRONG_KIND]: 'not_regular_file',
  [FileFailureReason.NOT_UTF8]: 'invalid_utf8',
  [FileFailureReason.ALREADY_EXISTS]: 'file_exists',
  [FileFailureReason.TEXT_NOT_FOUND]: 'old_text_not_found',
  [FileFailureReason.TEXT_AMBIGUOUS]: 'old_text_ambiguous',
  [FileFailureReason.OUTCOME_UNKNOWN]: 'outcome_unknown',
  [FileFailureReason.DIRECTORY_TOO_LARGE]: 'directory_too_large',
  [FileFailureReason.FILE_TOO_LARGE]: 'representation_too_large',
  [FileFailureReason.IO]: 'executor_unavailable',
};

export function failure(
  value: FileFailure | undefined,
): NativeFailureResult | undefined {
  if (value === undefined) return undefined;

  const mapped: NativeFailureResult = {
    status: 'error',
    type: failureTypes[value.reason] ?? 'executor_unavailable',
    message: value.message,
  };

  const count =
    value.details.case === 'ambiguousText'
      ? value.details.value.count
      : undefined;

  return count === undefined ? mapped : { ...mapped, count };
}

export function renderPath(path: string, prefix: string): string {
  return `${prefix}${path}`;
}

export function mapEntryKind(
  kind: EntryKind,
): 'file' | 'directory' | 'link' | 'other' {
  if (kind === EntryKind.FILE) return 'file';

  if (kind === EntryKind.DIRECTORY) return 'directory';

  if (kind === EntryKind.SYMLINK) return 'link';

  return 'other';
}
