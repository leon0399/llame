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
/**
 * What the vendor means by each error code it reports inside the XML body, also
 * after HTTP 200. Code 2 means the query was empty and code 15 that nothing was
 * found; both give an empty outcome. A code this
 * build does not know is `upstream_error`.
 */
const IN_BODY_ERRORS = {
  '2': 'empty',
  '15': 'empty',
  '32': 'rate_limited',
  '42': 'auth',
  '55': 'rate_limited',
  '100': 'challenge',
} as const satisfies Readonly<Record<string, FailureClass | 'empty'>>;
type InBodyErrorCode = keyof typeof IN_BODY_ERRORS;
/** The vendor `period` of one `recency` value, and the note where it differs. */
type RecencyPeriod = {
  readonly period?: string;
  readonly notes?: ReadonlyArray<string>;
};
const RECENCY_PERIODS: Readonly<
  Record<NonNullable<EngineRequest['recency']>, RecencyPeriod>
> = {
  day: { period: 'PERIOD_DAY' },
  week: {
    period: 'PERIOD_2_WEEKS',
    notes: ['yandex mapped week to two weeks'],
  },
  month: { period: 'PERIOD_MONTH' },
  year: { notes: ['recency not applied by yandex'] },
};
const YandexPayloadSchema = z.object({ rawData: z.string() });
/** `modtime`, the vendor's publication stamp, as `YYYYMMDDTHHMMSS`. */
const MODTIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/u;
const PARSER = new DOMParser();

type YandexEngineConfig = {
  readonly key: string;
  readonly searchType: YandexSearchType;
  readonly folderId: string | undefined;
};

/** Whether the vendor's code names one of the errors this build maps; the
 *  guard is what keeps the table lookup cast-free. */
function isInBodyErrorCode(code: string): code is InBodyErrorCode {
  return Object.hasOwn(IN_BODY_ERRORS, code);
}

function requestBody(
  config: YandexEngineConfig,
  request: EngineRequest,
  period: string | undefined,
) {
  return {
    query: {
      searchType: `SEARCH_TYPE_${config.searchType.toUpperCase()}`,
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
 * The XML document of one response. Bytes outside the alphabet decode to
 * nothing usable, so the root element is the whole check: anything but a
 * Yandex response is a vendor protocol failure, never an empty search.
 */
function parseResponse(rawData: string): Document {
  const document = PARSER.parseFromString(
    Buffer.from(rawData, 'base64').toString('utf8'),
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
 * `modtime` as the `YYYY-MM-DD` date the output keeps. The vendor documents no
 * time zone for the stamp, so no time is emitted.
 */
function publishedOf(modtime: string | undefined): string | undefined {
  const match = modtime === undefined ? null : MODTIME.exec(modtime);
  return match === null ? undefined : `${match[1]}-${match[2]}-${match[3]}`;
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
 * The empty outcome of a vendor error that means "nothing found", and a failure
 * for every other one. The vendor reports a search-level error in the body, also
 * after HTTP 200, and its text must not reach the output.
 */
function errorOutcome(document: Document): EngineOutcome | undefined {
  const error = document.querySelector('response > error');
  if (error === null) return undefined;
  const code = error.getAttribute('code') ?? '';
  const mapped = isInBodyErrorCode(code)
    ? IN_BODY_ERRORS[code]
    : 'upstream_error';
  if (mapped === 'empty') return { kind: 'empty' };
  throw new EngineFailure(mapped);
}

/** Create a Yandex Search API adapter for one resolved operator engine. */
export function createYandexEngine(
  config: YandexEngineConfig,
  deps: { readonly fetch: VendorFetch },
): Engine {
  return async (request: EngineRequest) => {
    const recency =
      request.recency === undefined
        ? undefined
        : RECENCY_PERIODS[request.recency];
    const notes = recency?.notes;
    const extra = notes === undefined ? {} : { notes };
    const payload = await fetchVendorJson(
      YANDEX_SEARCH_URL,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Api-Key ${config.key}`,
        },
        body: JSON.stringify(requestBody(config, request, recency?.period)),
      },
      {
        signal: request.signal,
        fetch: deps.fetch,
        userAgent: request.userAgent,
      },
      YandexPayloadSchema,
    );
    const document = parseResponse(payload.rawData);
    // The error is decided before any result, so a response that carries both
    // never reports partial results as success.
    const outcome = errorOutcome(document);
    if (outcome !== undefined) return { ...outcome, ...extra };
    const results = mapYandexResults(document);
    return results.length > 0
      ? { kind: 'results', results, ...extra }
      : { kind: 'empty', ...extra };
  };
}
