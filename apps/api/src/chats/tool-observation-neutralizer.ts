import { sanitizeAuthoredText } from '../instance-config/authored-text';
import { canonicalize, type CanonicalJsonValue } from '../canonical-json';
import {
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';
import { type ToolResult } from '../tools/types';

/**
 * Neutralize reserved delimiters in a tool result before the model sees it.
 * Applied to what is sent, never to what is recorded: stored observations
 * keep the tool's exact output. Native tools use protected JSON text through
 * the SDK's `toModelOutput` hook instead.
 */
export function neutralizeToolResult(result: ToolResult): ToolResult {
  if (result.status === 'error') {
    return {
      status: 'error',
      type: result.type,
      message: sanitizeAuthoredText(result.message),
    };
  }
  const { status, ...rest } = result;
  return { status, ...neutralizeJsonStrings(rest) };
}

function neutralizeJsonStrings(value: UnknownRecord): UnknownRecord {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      neutralizeValue(canonicalize(entry)),
    ]),
  );
}

function neutralizeValue(value: CanonicalJsonValue): CanonicalJsonValue {
  if (isString(value)) return sanitizeAuthoredText(value);
  if (Array.isArray(value)) return value.map(neutralizeValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        neutralizeValue(entry),
      ]),
    );
  }
  return value;
}
