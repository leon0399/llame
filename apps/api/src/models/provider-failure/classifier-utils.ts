import {
  isNumber,
  isRecord,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';

import {
  ProviderFailure,
  type FailureClass,
  type FailureInput,
} from './provider-failure';

export type FailureContext = {
  message: string;
  statusCode?: number;
  headers: Readonly<Record<string, string>>;
  error: UnknownRecord;
  transportError: UnknownRecord;
  code?: string;
  inStreamType?: string;
  now: number;
};

const finiteNumber = (
  value: string | number | undefined,
): number | undefined => {
  const number = isNumber(value)
    ? value
    : isString(value) && value.trim() !== ''
      ? Number(value)
      : Number.NaN;

  return Number.isFinite(number) ? number : undefined;
};

function responseHeaders(
  value: FailureInput['error'],
): Readonly<Record<string, string>> | undefined {
  if (!isRecord(value)) return undefined;

  const output: Record<string, string> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (isString(entry) || isNumber(entry))
      output[key.toLowerCase()] = String(entry);
  }

  return output;
}

function parseBody(value: FailureInput['error']): UnknownRecord {
  if (isString(value)) {
    try {
      const parsed: unknown = JSON.parse(value);

      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  return isRecord(value) ? value : {};
}

function bodyError(body: UnknownRecord): UnknownRecord {
  return isRecord(body.error) ? body.error : body;
}

function messageOf(error: FailureInput['error']): string {
  if (isRecord(error) && isString(error.message)) return error.message;

  return error instanceof Error ? error.message : 'Provider request failed';
}

function unwrapError(error: FailureInput['error']): UnknownRecord {
  if (!isRecord(error)) return {};

  return isRecord(error.lastError) ? error.lastError : error;
}

function decodeResponse(raw: UnknownRecord) {
  const response = isRecord(raw.response) ? raw.response : undefined;

  return {
    response,
    bodyFromResponse: parseBody(response?.body),
  };
}

function decodeResponseBody(input: FailureInput) {
  const raw = unwrapError(input.error);
  const { response, bodyFromResponse } = decodeResponse(raw);
  const body = parseBody(raw.responseBody);

  return {
    raw,
    response,
    selectedBody: Object.keys(body).length > 0 ? body : bodyFromResponse,
  };
}

function chooseErrorPayload(
  raw: UnknownRecord,
  response: UnknownRecord | undefined,
  selectedBody: UnknownRecord,
): UnknownRecord {
  const wrappedResponseError = isRecord(response?.error)
    ? response.error
    : undefined;

  const nestedResponseError = isRecord(wrappedResponseError?.error)
    ? wrappedResponseError.error
    : wrappedResponseError;

  const responseFailedError = isRecord(selectedBody.response)
    ? selectedBody.response.error
    : undefined;

  if (isRecord(responseFailedError)) return responseFailedError;
  const payloadError = bodyError(selectedBody);

  if (isRecord(payloadError.error)) return payloadError.error;

  if (Object.keys(payloadError).length > 0) return payloadError;

  const wrappedRawError = isRecord(raw.error) ? raw.error : undefined;

  const nestedRawError = isRecord(wrappedRawError?.error)
    ? wrappedRawError.error
    : wrappedRawError;

  const hasDirectSignal = [
    'code',
    'type',
    'details',
    'metadata',
    'resets_at',
    'error_code',
  ].some((key) => raw[key] !== undefined);

  return nestedResponseError ?? nestedRawError ?? (hasDirectSignal ? raw : {});
}

export function failureContext(input: FailureInput): FailureContext {
  const { raw, response, selectedBody } = decodeResponseBody(input);
  const error = chooseErrorPayload(raw, response, selectedBody);
  const details = isRecord(error.details) ? error.details : undefined;
  const codeValue = details?.error_code ?? error.error_code ?? error.code;
  const typeValue = error.type;
  const statusValue = raw.statusCode ?? raw.status ?? response?.status;

  const statusCode =
    isNumber(statusValue) || isString(statusValue)
      ? finiteNumber(statusValue)
      : undefined;

  const headersFromError = responseHeaders(raw.responseHeaders);
  const headersFromResponse = responseHeaders(response?.headers);

  const headers =
    headersFromError && Object.keys(headersFromError).length > 0
      ? headersFromError
      : headersFromResponse && Object.keys(headersFromResponse).length > 0
        ? headersFromResponse
        : (input.headers ?? headersFromError ?? headersFromResponse ?? {});

  return {
    message: isString(raw.message)
      ? raw.message
      : isString(error.message)
        ? error.message
        : messageOf(input.error),
    statusCode,
    headers,
    error,
    transportError: raw,
    code: isString(codeValue)
      ? codeValue.toLowerCase()
      : isNumber(codeValue)
        ? String(codeValue)
        : undefined,
    inStreamType: isString(typeValue) ? typeValue.toLowerCase() : undefined,
    now: input.now ?? Date.now(),
  };
}

export function makeFailure(
  context: FailureContext,
  code: FailureClass,
  extra: { resetsAt?: number; hintMs?: number } = {},
): ProviderFailure {
  return new ProviderFailure(context.message, {
    code,
    statusCode: context.statusCode,
    ...extra,
  });
}

export function header(
  headers: Readonly<Record<string, string>>,
  name: string,
): string | undefined {
  const wanted = name.toLowerCase();

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value;
  }

  return undefined;
}

export function parseRetryAfter(
  headers: Readonly<Record<string, string>>,
  now: number,
): number | undefined {
  const millis = finiteNumber(header(headers, 'retry-after-ms'));

  if (millis !== undefined && millis >= 0) return millis;

  const value = header(headers, 'retry-after');

  if (value === undefined || value.trim() === '') return undefined;
  const seconds = finiteNumber(value);

  if (seconds !== undefined && seconds >= 0) {
    const delay = seconds * 1000;

    return Number.isFinite(delay) ? delay : undefined;
  }

  const date = Date.parse(value);
  const delay = date - now;

  return Number.isFinite(delay) ? Math.max(0, delay) : undefined;
}

export function parseEpochSeconds(
  value: string | number | undefined,
): number | undefined {
  const seconds = finiteNumber(value);

  if (seconds === undefined || seconds < 0) return undefined;

  const ms = seconds * 1000;

  return Number.isFinite(ms) && ms <= 8_640_000_000_000_000 ? ms : undefined;
}

export function parseInstant(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;

  const instant = Date.parse(value);

  return Number.isFinite(instant) && instant >= 0 ? instant : undefined;
}

/** Parse provider reset durations such as `1s`, `6m0s`, and `250ms`. */
export function parseDurationMs(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;

  const text = value.trim().toLowerCase();

  if (!text) return undefined;
  const simple = finiteNumber(text);

  if (simple !== undefined) return simple >= 0 ? simple * 1000 : undefined;

  const pattern = /(?:\d+(?:\.\d+)?(?:ms|s|m|h))/gy;
  let cursor = 0;
  let total = 0;

  while (cursor < text.length) {
    pattern.lastIndex = cursor;
    const match = pattern.exec(text);

    if (!match) return undefined;

    const part = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(match[0]);

    if (!part) return undefined;
    const amount = Number(part[1]);

    const factor =
      part[2] === 'ms'
        ? 1
        : part[2] === 's'
          ? 1000
          : part[2] === 'm'
            ? 60_000
            : 3_600_000;

    total += amount * factor;
    cursor = pattern.lastIndex;
  }

  return Number.isFinite(total) && total >= 0 ? total : undefined;
}

export function bodyResetAt(context: FailureContext): number | undefined {
  const metadata = isRecord(context.error.metadata)
    ? context.error.metadata
    : undefined;

  const reset = metadata?.resets_at ?? context.error.resets_at;

  return isString(reset) ? parseInstant(reset) : undefined;
}
