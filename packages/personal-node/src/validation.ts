import { isRecord, isString, isNumber, type UnknownRecord } from '@workspace/runtime-safety';
import { CliError } from './errors';

export function record(value: unknown, label: string): UnknownRecord {
  if (!isRecord(value)) throw new CliError('invalid_data', `${label} must be an object.`);
  return value;
}

export function text(value: unknown, label: string, max = 20_000): string {
  if (!isString(value) || !value.length || value.length > max) {
    throw new CliError('invalid_data', `${label} must be a nonempty string (maximum ${max} characters).`);
  }
  return value;
}

export function integer(value: unknown, label: string, min: number, max: number): number {
  if (!isNumber(value) || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new CliError('invalid_data', `${label} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

export function keys(value: UnknownRecord, allowed: readonly string[], label: string): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new CliError('unknown_field', `${label} contains an unsupported field.`);
  }
}

export function uuid(value: unknown): string {
  const id = text(value, 'ID', 36);
  if (!/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(id)) {
    throw new CliError('invalid_id', 'Expected a UUID.');
  }
  return id;
}

export function parseJson(value: string): unknown {
  try { return JSON.parse(value); }
  catch { throw new CliError('invalid_json', 'Invalid JSON.'); }
}

/** Restrict credentials to an explicit authority; never follow redirects. */
export function authority(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new CliError('invalid_url', 'Expected an absolute HTTPS URL.'); }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new CliError('insecure_url', 'HTTPS is required; HTTP is allowed only for literal 127.0.0.1 or [::1].');
  }
  if (url.username || url.password || url.search || url.hash || /%2f|%5c/i.test(url.pathname)) {
    throw new CliError('invalid_url', 'URL credentials, query, fragment and encoded separators are not allowed.');
  }
  return url.href.replace(/\/+$/, '');
}
