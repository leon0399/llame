import { isRecord, isString } from '@workspace/runtime-safety';

import type { FailureInput, ProviderFailure } from './provider-failure';
import {
  failureContext,
  makeFailure,
  type FailureContext,
} from './classifier-utils';
import {
  anthropicResetAt,
  codexResetAt,
  codexWindowExhausted,
  openAiResetAt,
  openRouterResetAt,
  retryHintMs,
} from './reset-signals';
import {
  isOpenAIProvider,
  isAnthropicProvider,
  defaultCodeRule,
  messageRule,
  providerRule,
  statusRule,
} from './provider-rules';

const TRANSPORT_CODES = {
  ECONNABORTED: true,
  ECONNREFUSED: true,
  ECONNRESET: true,
  EHOSTUNREACH: true,
  ENETUNREACH: true,
  ENOTFOUND: true,
  EAI_AGAIN: true,
  ETIMEDOUT: true,
  EPIPE: true,
  UND_ERR_CONNECT_TIMEOUT: true,
  UND_ERR_SOCKET: true,
  UND_ERR_HEADERS_TIMEOUT: true,
  UND_ERR_BODY_TIMEOUT: true,
} satisfies Record<string, true>;

type ClassSelection = Pick<ProviderFailure, 'code' | 'resetsAt'>;

function transportFailure(context: FailureContext): boolean {
  if (context.statusCode !== undefined && context.statusCode >= 400)
    return false;

  const current = context.transportError;
  const cause = isRecord(current.cause) ? current.cause : undefined;
  const code = current.code ?? cause?.code;

  if (isString(code) && Object.hasOwn(TRANSPORT_CODES, code.toUpperCase()))
    return true;

  return (
    current.name === 'AI_APICallError' &&
    cause?.name === 'TypeError' &&
    cause.message === 'fetch failed'
  );
}

function selectFailureClass(
  context: FailureContext,
  provider: string,
  wire: 'responses' | 'completions' | 'anthropic',
): ClassSelection {
  const bodyRule = providerRule(provider, context, context.code);

  if (bodyRule) return bodyRule;

  const bodyCode =
    (wire === 'anthropic' ? messageRule(context) : undefined) ??
    defaultCodeRule(context.code);

  if (bodyCode) return { code: bodyCode };

  const typeRule = providerRule(provider, context, context.inStreamType);

  if (typeRule) return typeRule;

  const typeCode = defaultCodeRule(context.inStreamType);

  if (typeCode) return { code: typeCode };

  if (
    provider === 'openai-codex' &&
    context.statusCode === 429 &&
    codexWindowExhausted(context)
  ) {
    return { code: 'quota_exhausted', resetsAt: codexResetAt(context) };
  }

  return {
    code:
      statusRule(context.statusCode) ??
      (transportFailure(context) ? 'unreachable' : 'unknown'),
  };
}

function selectReset(
  context: FailureContext,
  provider: string,
  wire: 'responses' | 'completions' | 'anthropic',
  selection: ClassSelection,
): number | undefined {
  if (selection.code !== 'quota_exhausted' && selection.code !== 'rate_limited')
    return undefined;

  if (selection.resetsAt !== undefined) return selection.resetsAt;

  if (provider === 'openai-codex') return codexResetAt(context);

  if (selection.code === 'rate_limited') {
    if (wire === 'anthropic') return anthropicResetAt(context);

    return isOpenAIProvider(provider) ? openAiResetAt(context) : undefined;
  }

  if (provider === 'openrouter') return openRouterResetAt(context);

  if (isOpenAIProvider(provider) || isAnthropicProvider(provider))
    return undefined;

  const delay = retryHintMs(context);

  if (delay === undefined) return undefined;

  return context.now + delay;
}

export function classifyForWire(
  input: FailureInput,
  wire: 'responses' | 'completions' | 'anthropic',
): ProviderFailure {
  const context = failureContext(input);
  const status = context.statusCode;

  const unreadable =
    context.transportError.name === 'JSONParseError' ||
    context.transportError.name === 'TypeValidationError' ||
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308;

  if (unreadable) return makeFailure(context, 'unknown');

  const provider = input.provider.toLowerCase();
  const selection = selectFailureClass(context, provider, wire);
  const resetsAt = selectReset(context, provider, wire, selection);

  return makeFailure(context, selection.code, {
    resetsAt,
    hintMs: retryHintMs(context),
  });
}
