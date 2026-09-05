import { isString } from '@workspace/runtime-safety';
/** Error text is operator-authored; never wrap an untrusted HTTP body here. */
export class CliError extends Error {
  constructor(readonly code: string, message: string, readonly exitCode = 1) {
    super(message);
    this.name = 'CliError';
  }
}

export function aborted(signal: AbortSignal): void {
  if (signal.aborted) throw new CliError('cancelled', 'Operation cancelled.', 130);
}

export function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && isString(error.code)
    ? error.code : undefined;
}
