import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { isRecord, isString } from '@workspace/runtime-safety';
import { RetryError, type ModelMessage, type ToolSet } from 'ai';

import { type WebSearchEngineConfig } from '../../instance-config/llame-config';
import {
  type ModelStreamInput,
  type ModelStreamResult,
} from '../../models/model-client';
import { loadPackagedTemplate } from '../../prompts/template-engine';
import {
  EngineFailure,
  throwAbort,
  type Engine,
  type EngineRequest,
  type RawCitation,
} from './chain';
import { splitSiteFilters, type SiteFilters } from './query';

type HostedConfig = Extract<
  WebSearchEngineConfig,
  { readonly type: 'model-hosted' }
>;
type ModelSource = Awaited<ModelStreamResult['sources']>[number];
type UrlSource = Extract<ModelSource, { readonly sourceType: 'url' }>;
type HostedAnswer = {
  readonly text: string;
  readonly sources: ReadonlyArray<ModelSource>;
};

/**
 * The system text of every hosted search sub-request, packaged as
 * `prompts/hosted-search-instructions.md`. Rendered at import, so a missing or
 * empty template fails at startup instead of as a blank model-facing prompt.
 */
export const HOSTED_SEARCH_INSTRUCTIONS = loadPackagedTemplate<
  Record<string, never>
>(
  __dirname,
  'hosted-search-instructions',
)({});

/** Anthropic bills and bounds server-side searches per request. */
const ANTHROPIC_MAX_SEARCHES = 5;

/** What a query's `site:` and `-site:` hosts become on the hosted search tool. */
type DomainPlan = {
  readonly allowedDomains: Array<string>;
  readonly blockedDomains: Array<string>;
  /** Whether `-site:` hosts were dropped because the wire accepts one list. */
  readonly droppedExclusions: boolean;
};

/** What differs between the hosted-search wires. */
type WireProfile = {
  readonly tools: (plan: DomainPlan) => ToolSet;
  readonly toolChoice: ModelStreamInput['toolChoice'];
  readonly isCitation: (source: UrlSource) => boolean;
  /** The wire rejects one request that sets both domain lists. */
  readonly singleDomainList: boolean;
};

/** The query's hosts as one tool's domain lists; Anthropic keeps the inclusions. */
function domainPlan(wire: WireProfile, filters: SiteFilters): DomainPlan {
  const droppedExclusions =
    wire.singleDomainList &&
    filters.include.length > 0 &&
    filters.exclude.length > 0;
  return {
    allowedDomains: filters.include,
    blockedDomains: droppedExclusions ? [] : filters.exclude,
    droppedExclusions,
  };
}

/** The OpenAI `filters` object, absent when the query names no host. */
function openaiFilters(plan: DomainPlan) {
  if (plan.allowedDomains.length === 0 && plan.blockedDomains.length === 0)
    return undefined;
  return {
    ...(plan.allowedDomains.length > 0 && {
      allowedDomains: plan.allowedDomains,
    }),
    ...(plan.blockedDomains.length > 0 && {
      blockedDomains: plan.blockedDomains,
    }),
  };
}

function anthropicWebSearch(plan: DomainPlan): ToolSet[string] {
  const searchTool = anthropic.tools.webSearch_20250305({
    maxUses: ANTHROPIC_MAX_SEARCHES,
    ...(plan.allowedDomains.length > 0 && {
      allowedDomains: plan.allowedDomains,
    }),
    ...(plan.blockedDomains.length > 0 && {
      blockedDomains: plan.blockedDomains,
    }),
  });
  // SAFETY: `@ai-sdk/anthropic` resolves its own copy of `@ai-sdk/provider-utils`, so the tool's schema type carries a different `unique symbol` than the `ToolSet` of `ai`. Both copies register the schema brand with `Symbol.for("vercel.ai.schema")`, so the value is the SDK's own, valid provider tool at runtime.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- type-only mismatch between two installed copies of one package; the value is not reshaped.
  return searchTool as ToolSet[string];
}

const OPENAI_WIRE: WireProfile = {
  tools: (plan) => {
    const filters = openaiFilters(plan);
    return {
      web_search: openai.tools.webSearch({
        ...(filters !== undefined && { filters }),
      }),
    };
  },
  // A required choice makes the model search instead of answering from memory.
  toolChoice: 'required',
  // Every `url_citation` annotation is a source the answer text cites.
  isCitation: () => true,
  singleDomainList: false,
};

// The Messages wire does not force the search: forced tool use is rejected
// while thinking is enabled, which an operator's provider options may do. An
// answer that skipped the search cites nothing and is `ungrounded` anyway.
const ANTHROPIC_WIRE: WireProfile = {
  tools: (plan) => ({
    web_search: anthropicWebSearch(plan),
  }),
  toolChoice: undefined,
  // The adapter also emits a source for every retrieved result; only a
  // `web_search_result_location` citation carries the text it supports.
  isCitation: (source) =>
    isString(source.providerMetadata?.anthropic?.citedText),
  singleDomainList: true,
};

// The Codex backend is not documented to accept a bare `required` choice;
// Codex clients that force a search name the hosted tool instead, which the
// adapter sends as `{ type: "web_search" }`.
const CODEX_WIRE: WireProfile = {
  ...OPENAI_WIRE,
  toolChoice: { type: 'tool', toolName: 'web_search' },
};

const WIRES: Record<HostedConfig['wire'], WireProfile> = {
  'openai-responses': OPENAI_WIRE,
  'openai-codex': CODEX_WIRE,
  'anthropic-messages': ANTHROPIC_WIRE,
};

function hostedMessages(request: EngineRequest): Array<ModelMessage> {
  const recency =
    request.recency === undefined
      ? ''
      : `\n\nOnly use sources published within the last ${request.recency}.`;
  // A goal line, never the query text: the model still searches the keywords.
  const goal =
    request.objective === undefined ? '' : `\n\nGoal: ${request.objective}`;
  return [{ role: 'user', content: `${request.query}${recency}${goal}` }];
}

/**
 * Classifies a provider failure by the HTTP status it carries, unwrapping the
 * SDK's retry wrapper. Nothing else of the error is read, so no upstream text,
 * header, or body can reach a note, a log, or a Run event.
 */
function providerFailure(error: unknown): EngineFailure {
  const response = RetryError.isInstance(error) ? error.lastError : error;
  const status = isRecord(response) ? response['statusCode'] : undefined;
  if (status === 401 || status === 403) return new EngineFailure('auth');
  return new EngineFailure(status === 429 ? 'rate_limited' : 'upstream_error');
}

/**
 * One request to the referenced model with only the packaged instructions, the
 * query, and the provider's search tool: no history, no Run system prompt, no
 * effort, and no usage callback, so the Run never accounts for it.
 */
async function requestHostedAnswer(
  config: HostedConfig,
  wire: WireProfile,
  plan: DomainPlan,
  request: EngineRequest,
): Promise<HostedAnswer> {
  const { modelClients } = request;
  if (modelClients?.createClient === undefined)
    throw new EngineFailure('upstream_error');
  // The AI SDK reports a provider failure through `onError`; the result's
  // `text` then rejects with a generic "no output" error that carries none of
  // it. The callback also replaces the SDK's default, which logs the raw error.
  const failures: Array<unknown> = [];
  try {
    const result = modelClients.createClient(config.model).streamText({
      chat: { id: request.chatId, lane: 'search' },
      system: HOSTED_SEARCH_INSTRUCTIONS,
      messages: hostedMessages(request),
      tools: wire.tools(plan),
      toolChoice: wire.toolChoice,
      // One search step, then one tool-free answer step at most: a provider
      // turn that pauses before its deferred search result cannot loop.
      maxSteps: 1,
      abortSignal: request.signal,
      onError: ({ error }) => {
        failures.push(error);
      },
    });
    const text = await result.text;
    const sources = await result.sources;
    if (failures.length === 0) return { text, sources };
  } catch {
    // Classified below from what `onError` reported, else as an upstream error.
  }
  if (request.signal.aborted) throwAbort(request.signal);
  throw providerFailure(failures[0]);
}

/**
 * Create a model-hosted search engine: one grounded sub-request to the
 * referenced model, answered with its final text and the URLs that text cites.
 */
export function createModelHostedEngine(config: HostedConfig): Engine {
  return async (request) => {
    const wire = WIRES[config.wire];
    const plan = domainPlan(wire, splitSiteFilters(request.query));
    const { text, sources } = await requestHostedAnswer(
      config,
      wire,
      plan,
      request,
    );
    const citations = sources.flatMap((source): Array<RawCitation> => {
      if (source.sourceType !== 'url' || !wire.isCitation(source)) return [];
      return [
        {
          url: source.url,
          ...(source.title !== undefined && { title: source.title }),
        },
      ];
    });
    if (text.trim().length === 0 || citations.length === 0)
      throw new EngineFailure('ungrounded');
    return {
      kind: 'answer',
      answer: text,
      citations,
      ...(plan.droppedExclusions && {
        notes: ['model-hosted ignored the excluded domains'],
      }),
    };
  };
}
