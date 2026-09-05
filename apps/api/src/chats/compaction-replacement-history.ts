import type { CompactionReplacementMessage } from '../db/schema/chats';
import { isRecord, isString, type UnknownRecord } from '@workspace/runtime-safety';

const TOOL_PART_PREFIX = 'tool-';
const TOOL_CALL_ID_MAX_LENGTH = 1024;
const TOOL_NAME_MAX_LENGTH = 64;
const TOOL_OUTCOME_MAX_LENGTH = 128;
const TOOL_CALL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u;
const TOOL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const TOOL_OUTCOME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u;

export interface StoredReplacementToolPart {
  type: `tool-${string}`;
  toolCallId: string;
  state: 'output-available';
  input: UnknownRecord;
  output: string;
  outcome: string;
}

function isBoundedToken(
  value: unknown,
  maxLength: number,
  pattern: RegExp,
): value is string {
  if (!isString(value)) return false;
  return value.length > 0 && value.length <= maxLength && pattern.test(value);
}

function isNonEmptyTextPart(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    value.type === 'text' &&
    isString(value.text) &&
    value.text.trim().length > 0
  );
}

export function renderToolObservationOmission(count: number): string {
  return `[${count} earlier tool observations omitted to fit replay budget.]`;
}

export function parseToolObservationOmission(value: unknown): number | null {
  if (!isRecord(value)) return null;
  if (value.type !== 'text' || !isString(value.text)) return null;
  const match =
    /^\[(\d+) earlier tool observations omitted to fit replay budget\.\]$/u.exec(
      value.text,
    );
  if (!match) return null;
  const count = Number(match[1]);
  return Number.isSafeInteger(count) &&
    count > 0 &&
    renderToolObservationOmission(count) === value.text
    ? count
    : null;
}

function isUnknownArray(value: unknown): value is Array<unknown> {
  return Array.isArray(value);
}

function isCompactionReplacementMessage(
  value: unknown,
): value is CompactionReplacementMessage {
  return (
    isRecord(value) &&
    (value.role === 'user' || value.role === 'assistant') &&
    isUnknownArray(value.parts)
  );
}

export function isStoredReplacementToolPart(
  value: unknown,
): value is StoredReplacementToolPart {
  if (!isRecord(value)) return false;
  const type = value.type;
  const toolName = isString(type) ? type.slice(TOOL_PART_PREFIX.length) : '';
  return (
    isString(type) &&
    type.startsWith(TOOL_PART_PREFIX) &&
    isBoundedToken(toolName, TOOL_NAME_MAX_LENGTH, TOOL_NAME_PATTERN) &&
    isBoundedToken(
      value.toolCallId,
      TOOL_CALL_ID_MAX_LENGTH,
      TOOL_CALL_ID_PATTERN,
    ) &&
    value.state === 'output-available' &&
    isRecord(value.input) &&
    Object.keys(value.input).length === 0 &&
    isString(value.output) &&
    value.output.length > 0 &&
    isBoundedToken(value.outcome, TOOL_OUTCOME_MAX_LENGTH, TOOL_OUTCOME_PATTERN)
  );
}

export function parseCompactionReplacementHistory(
  value: unknown,
): Array<CompactionReplacementMessage> | null {
  if (!isUnknownArray(value)) return null;
  if (value.length === 0) return null;

  const records: Array<CompactionReplacementMessage> = [];
  for (const [index, record] of value.entries()) {
    if (!isCompactionReplacementMessage(record)) return null;
    if (record.parts.length !== 1) return null;
    const part = record.parts[0];

    if (index === 0) {
      if (record.role !== 'user' || !isNonEmptyTextPart(part)) return null;
      records.push(record);
      continue;
    }

    if (record.role !== 'assistant') return null;
    if (isStoredReplacementToolPart(part)) {
      records.push(record);
      continue;
    }
    if (
      index !== value.length - 1 ||
      parseToolObservationOmission(part) === null
    ) {
      return null;
    }
    records.push(record);
  }

  return records;
}
