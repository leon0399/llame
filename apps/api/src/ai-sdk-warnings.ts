import type { LogWarningsFunction, Warning } from 'ai';

/**
 * `@ai-sdk/openai` embeds the whole skipped prompt part as JSON in two of its
 * `other` warnings, and that part carries the reasoning text, the item id, and
 * the encrypted content. Keep the sentence that names the condition and drop
 * the payload: reasoning metadata never reaches the logs (reasoning-output).
 */
function withoutPartPayload(message: string): string {
  const payload = message.indexOf('{');
  return payload === -1
    ? message
    : `${message.slice(0, payload).trimEnd()} <part omitted>`;
}

/** One adapter warning as a log line: its type and a payload-free condition. */
function warningLine(warning: Warning): string {
  switch (warning.type) {
    case 'other':
      return `other: ${withoutPartPayload(warning.message)}`;
    case 'unsupported':
    case 'compatibility':
      return `${warning.type}: ${warning.feature}${
        warning.details === undefined ? '' : ` (${warning.details})`
      }`;
  }
}

/**
 * The AI SDK's warning logger for every adapter call. The SDK's default prints
 * each warning's message verbatim with `console.warn`, which would write a
 * replayed reasoning part — item id, encrypted content, or plaintext reasoning
 * — into the process log and Sentry's console breadcrumbs. The redacted line
 * still goes through `console.warn`, so it reaches both; and the only import
 * here is type-only, so loading this module evaluates nothing — `instrument.ts`
 * requires it before Sentry starts (that file's first-import rule).
 */
export const logModelWarnings: LogWarningsFunction = ({
  warnings,
  provider,
  model,
}) => {
  for (const warning of warnings) {
    console.warn(
      `AI SDK warning (${provider} / ${model}): ${warningLine(warning)}`,
    );
  }
};

/**
 * Installs the redacting logger above as the SDK's warning sink. Both
 * entrypoints (`main.ts` and `worker.ts`) call this once at bootstrap, from
 * `instrument.ts`, before any adapter call can emit a warning.
 */
export function installAiSdkWarningLogger(): void {
  globalThis.AI_SDK_LOG_WARNINGS = logModelWarnings;
}
