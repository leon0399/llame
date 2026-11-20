import { isNumber, isRecord, isString } from '@workspace/runtime-safety';

import type { FailureContext } from './classifier-utils';
import {
  bodyResetAt,
  header,
  parseDurationMs,
  parseEpochSeconds,
  parseInstant,
  parseRetryAfter,
} from './classifier-utils';

export function codexWindowExhausted(context: FailureContext): boolean {
  return ['primary', 'secondary'].some((window) => {
    const usedText = header(context.headers, `x-codex-${window}-used-percent`);
    const used = usedText === undefined ? Number.NaN : Number(usedText);

    return Number.isFinite(used) && used >= 100;
  });
}

export function codexResetAt(context: FailureContext): number | undefined {
  const resetValue = context.error.resets_at;

  const direct =
    isString(resetValue) || isNumber(resetValue)
      ? parseEpochSeconds(resetValue)
      : undefined;

  if (direct !== undefined) return direct;

  let latest: number | undefined;

  for (const window of ['primary', 'secondary']) {
    const usedText = header(context.headers, `x-codex-${window}-used-percent`);
    const used = usedText === undefined ? Number.NaN : Number(usedText);

    if (!Number.isFinite(used) || used < 100) continue;

    const reset = parseEpochSeconds(
      header(context.headers, `x-codex-${window}-reset-at`),
    );

    if (reset !== undefined && (latest === undefined || reset > latest))
      latest = reset;
  }

  return latest;
}

export function anthropicResetAt(context: FailureContext): number | undefined {
  let latest: number | undefined;

  for (const [name, remaining] of Object.entries(context.headers)) {
    const match = /^anthropic-ratelimit-(.+)-remaining$/i.exec(name);
    const remainingValue = Number(remaining);

    if (
      !match ||
      remaining.trim() === '' ||
      !Number.isFinite(remainingValue) ||
      remainingValue !== 0
    )
      continue;

    const instant = parseInstant(
      header(context.headers, `anthropic-ratelimit-${match[1]}-reset`),
    );

    if (instant !== undefined && (latest === undefined || instant > latest))
      latest = instant;
  }

  return latest;
}

export function openAiResetAt(context: FailureContext): number | undefined {
  let latest: number | undefined;

  for (const [name, remaining] of Object.entries(context.headers)) {
    const match = /^x-ratelimit-remaining-(.+)$/i.exec(name);
    const remainingValue = Number(remaining);

    if (
      !match ||
      remaining.trim() === '' ||
      !Number.isFinite(remainingValue) ||
      remainingValue !== 0
    )
      continue;

    const duration = parseDurationMs(
      header(context.headers, `x-ratelimit-reset-${match[1]}`),
    );

    if (duration === undefined) continue;
    const instant = context.now + duration;

    if (Number.isFinite(instant) && (latest === undefined || instant > latest))
      latest = instant;
  }

  return latest;
}

export function openRouterResetAt(context: FailureContext): number | undefined {
  return bodyResetAt(context);
}

export function goResetAt(context: FailureContext): number | undefined {
  const delay = parseRetryAfter(context.headers, context.now);

  if (delay === undefined) return undefined;

  const instant = context.now + delay;

  return Number.isFinite(instant) ? instant : undefined;
}

export function retryHintMs(context: FailureContext): number | undefined {
  return parseRetryAfter(context.headers, context.now);
}

export function openRouterBudget(
  context: FailureContext,
): { class: 'quota_exhausted' | 'billing'; resetsAt?: number } | undefined {
  const details = isRecord(context.error.metadata)
    ? context.error.metadata
    : undefined;

  const source = context.error.limit_source ?? details?.limit_source;

  if (!isString(source) || source.trim() === '') return undefined;

  const resets = context.error.resets_at ?? details?.resets_at;

  if (resets === null || resets === undefined) return { class: 'billing' };
  const resetsAt = isString(resets) ? parseInstant(resets) : undefined;

  return resetsAt === undefined
    ? { class: 'quota_exhausted' }
    : { class: 'quota_exhausted', resetsAt };
}
