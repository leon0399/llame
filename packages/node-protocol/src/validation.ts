import { isRecord, type UnknownRecord } from '@workspace/runtime-safety';
import { NodeProtocolError } from './errors';

export function object(value: unknown): UnknownRecord {
  if (!isRecord(value)) throw new NodeProtocolError('invalid_params', 'Expected an object.');
  return value;
}
export function exactKeys(value: UnknownRecord, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) {
    throw new NodeProtocolError('invalid_params', 'Unknown request field.');
  }
}
export function string(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || value.includes('\0')) {
    throw new NodeProtocolError('invalid_params', `Invalid ${label}.`);
  }
  return value;
}
export function uuid(value: unknown): string {
  const id = string(value, 'resource ID', 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)) {
    throw new NodeProtocolError('invalid_params', 'Invalid resource ID.');
  }
  return id;
}
export function integer(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new NodeProtocolError('invalid_params', `Invalid ${label}.`);
  }
  return value;
}
