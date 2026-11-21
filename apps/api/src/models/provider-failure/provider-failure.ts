export const FAILURE_CLASSES = [
  'quota_exhausted',
  'billing',
  'rate_limited',
  'overloaded',
  'server_error',
  'unreachable',
  'first_token_timeout',
  'stream_broken',
  'model_not_found',
  'auth',
  'context_overflow',
  'invalid_request',
  'content_policy',
  'unknown',
] as const;

export type FailureClass = (typeof FAILURE_CLASSES)[number];

export type FailureInput = {
  error: unknown;
  provider: string;
  headers?: Readonly<Record<string, string>>;
  now?: number;
};

export type ProviderFailureSuperseded = {
  retry: number;
  delayMs: number;
};

export type ProviderFailureDetails = {
  code: FailureClass;
  resetsAt?: number;
  hintMs?: number;
  statusCode?: number;
  superseded?: ProviderFailureSuperseded;
  toolCallStarted?: true;
  /** Sends of this logical request so far, including the failed one. */
  sends?: number;
};

/** A provider failure with a closed classification and safe timing metadata. */
export class ProviderFailure extends Error {
  override readonly name = 'ProviderFailure';
  readonly code: FailureClass;
  readonly resetsAt?: number;
  readonly hintMs?: number;
  readonly statusCode?: number;
  readonly superseded?: ProviderFailureSuperseded;
  readonly toolCallStarted?: true;
  /** Sends of this logical request so far, including the failed one. */
  readonly sends?: number;

  constructor(message: string, details: ProviderFailureDetails) {
    super(message);
    this.code = details.code;

    if (details.toolCallStarted) this.toolCallStarted = true;

    if (details.sends) this.sends = details.sends;

    if (
      details.resetsAt !== undefined &&
      Number.isFinite(details.resetsAt) &&
      details.resetsAt >= 0 &&
      details.resetsAt <= 8_640_000_000_000_000
    ) {
      this.resetsAt = details.resetsAt;
    }

    if (
      details.hintMs !== undefined &&
      Number.isFinite(details.hintMs) &&
      details.hintMs >= 0
    ) {
      this.hintMs = details.hintMs;
    }

    if (
      details.statusCode !== undefined &&
      Number.isFinite(details.statusCode)
    ) {
      this.statusCode = details.statusCode;
    }

    if (
      details.superseded !== undefined &&
      Number.isSafeInteger(details.superseded.retry) &&
      details.superseded.retry > 0 &&
      Number.isFinite(details.superseded.delayMs) &&
      details.superseded.delayMs >= 0
    ) {
      this.superseded = {
        retry: details.superseded.retry,
        delayMs: details.superseded.delayMs,
      };
    }
  }
}
