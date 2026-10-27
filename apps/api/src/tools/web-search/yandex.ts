import { DOMParser } from 'linkedom';
import { z } from 'zod';
import { type YandexSearchType } from '../../instance-config/web-search-config';
import {
  EngineFailure,
  type Engine,
  type EngineOutcome,
  type EngineRequest,
  type FailureClass,
  type RawResult,
} from './chain';
import { fetchVendorJson, type VendorFetch } from './http';
import { vendorCount } from './limits';

export const YANDEX_SEARCH_URL =
  'https://searchapi.api.cloud.yandex.net/v2/web/search';
/** Passages per document for the snippet; the vendor takes 1 to 5. */
const MAX_PASSAGES = 3;
const WEEK_NOTE = 'yandex mapped week to two weeks';
const YEAR_NOTE = 'recency not applied by yandex';
/**
 * Error codes the vendor reports inside the XML body, also after HTTP 200.
 * Codes 2 and 15 mean the search found nothing; any other code is
 * `upstream_error`.
 */
const IN_BODY_FAILURES = {
  '32': 'rate_limited',
  '42': 'auth',
  '55': 'rate_limited',
  '100': 'challenge',
} as const satisfies Readonly<Record<string, FailureClass>>;
const EMPTY_ERROR_CODES = { '2': true, '15': true } as const;
/** A `searchType` as the vendor spells it. */
const SEARCH_TYPES: Readonly<Record<YandexSearchType, string>> = {
  be: 'SEARCH_TYPE_BE',
  com: 'SEARCH_TYPE_COM',
  kk: 'SEARCH_TYPE_KK',
  ru: 'SEARCH_TYPE_RU',
  tr: 'SEARCH_TYPE_TR',
  uz: 'SEARCH_TYPE_UZ',
};
const YandexPayloadSchema = z.object({ rawData: z.string() });
/** The vendor's Base64 alphabet; a body outside it is not a response. */
const BASE64_PAYLOAD = /^[A-Za-z0-9+/]+={0,2}$/u;
/** `modtime`, the vendor's publication stamp, as `YYYYMMDDTHHMMSS`. */
const MODTIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/u;
const PARSER = new DOMParser();

function isInBodyFailure(code: string): code is keyof typeof IN_BODY_FAILURES {
  return Object.hasOwn(IN_BODY_FAILURES, code);
}

type YandexEngineConfig = {
  readonly key: string;
  readonly searchType: YandexSearchType;
  readonly folderId: string | undefined;
};
type RecencyPeriod = {
  readonly period?: string;
  readonly notes?: ReadonlyArray<string>;
};

/** The recency `period` the vendor takes, and the note when it differs. */
function periodOf(recency: EngineRequest['recency']): RecencyPeriod {
  switch (recency) {
    case 'day':
      return { period: 'PERIOD_DAY' };
    case 'week':
      return { period: 'PERIOD_2_WEEKS', notes: [WEEK_NOTE] };
    case 'month':
      return { period: 'PERIOD_MONTH' };
    case 'year':
      return { notes: [YEAR_NOTE] };
    default:
      return {};
  }
}

function requestBody(
  config: YandexEngineConfig,
  request: EngineRequest,
  period: string | undefined,
) {
  return {
    query: {
      searchType: SEARCH_TYPES[config.searchType],
      queryText: request.query,
      familyMode: 'FAMILY_MODE_MODERATE',
    },
    // Flat groups keep one result per group, so `groupsOnPage` counts results;
    // the vendor's default deep grouping keeps one document per host.
    groupSpec: {
      groupMode: 'GROUP_MODE_FLAT',
      groupsOnPage: vendorCount('yandex', request.limit),
      docsInGroup: 1,
    },
    maxPassages: MAX_PASSAGES,
    responseFormat: 'FORMAT_XML',
    ...(period !== undefined && { period }),
    ...(config.folderId !== undefined && { folderId: config.folderId }),
  };
}

/**
 * The XML document of one response. A body outside the decoder's reach is a
 * vendor protocol failure, never an empty search.
 */
function parseResponse(rawData: string): Document {
  const base64 = rawData.replaceAll(/\s+/gu, '');
  if (base64.length % 4 !== 0 || !BASE64_PAYLOAD.test(base64))
    throw new EngineFailure('upstream_error');
  const document = PARSER.parseFromString(
    Buffer.from(base64, 'base64').toString('utf8'),
    'text/xml',
  );
  if (document.querySelector('yandexsearch') === null)
    throw new EngineFailure('upstream_error');
  return document;
}

function textOf(element: Element, selector: string): string | undefined {
  const text = element.querySelector(selector)?.textContent?.trim();
  return text === undefined || text === '' ? undefined : text;
}

/**
 * `modtime` as an ISO 8601 instant, which is the only `published` the output
 * keeps.
 */
function publishedOf(modtime: string | undefined): string | undefined {
  const match = modtime === undefined ? null : MODTIME.exec(modtime);
  if (match === null) return undefined;
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
}

/**
 * The documents of a flat grouping. `title` arrives HTML-escaped and with the
 * query words wrapped in `<hlword>`; the XML parse reads both as text.
 */
function mapYandexResults(document: Document): Array<RawResult> {
  return Array.from(document.querySelectorAll('group > doc')).flatMap((doc) => {
    const url = textOf(doc, 'url');
    if (url === undefined) return [];
    const snippet =
      textOf(doc, 'headline') ?? textOf(doc, 'passages > passage');
    const published = publishedOf(textOf(doc, 'modtime'));
    return [
      {
        title: textOf(doc, 'title') ?? '',
        url,
        ...(snippet !== undefined && { snippet }),
        ...(published !== undefined && { published }),
      },
    ];
  });
}

/**
 * The outcome of one XML response. The vendor reports a search-level error in
 * the body, also after HTTP 200, and its text must not reach the output, so the
 * error code is read before any result.
 */
function outcomeOf(
  document: Document,
  notes: ReadonlyArray<string> | undefined,
): EngineOutcome {
  const error = document.querySelector('response > error');
  if (error !== null) {
    const code = error.getAttribute('code') ?? '';
    if (Object.hasOwn(EMPTY_ERROR_CODES, code)) return { kind: 'empty' };
    throw new EngineFailure(
      isInBodyFailure(code) ? IN_BODY_FAILURES[code] : 'upstream_error',
    );
  }
  const results = mapYandexResults(document);
  const extra = notes === undefined ? {} : { notes };
  return results.length > 0
    ? { kind: 'results', results, ...extra }
    : { kind: 'empty', ...extra };
}

async function fetchDocument(
  config: YandexEngineConfig,
  deps: { readonly fetch: VendorFetch },
  request: EngineRequest,
  period: string | undefined,
): Promise<Document> {
  const payload = await fetchVendorJson(
    YANDEX_SEARCH_URL,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Api-Key ${config.key}`,
      },
      body: JSON.stringify(requestBody(config, request, period)),
    },
    {
      signal: request.signal,
      fetch: deps.fetch,
      userAgent: request.userAgent,
    },
    YandexPayloadSchema,
  );
  return parseResponse(payload.rawData);
}

/** Create a Yandex Search API adapter for one resolved operator engine. */
export function createYandexEngine(
  config: YandexEngineConfig,
  deps: { readonly fetch: VendorFetch },
): Engine {
  return async (request: EngineRequest) => {
    const { period, notes } = periodOf(request.recency);
    return outcomeOf(await fetchDocument(config, deps, request, period), notes);
  };
}
