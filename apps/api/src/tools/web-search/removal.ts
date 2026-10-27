import { type ToolContext } from '../types';
import { evaluateWebLocatorRead } from '../web-read/admission';
import { canonicalUrl } from './output';

/**
 * One call's entry removal rule: whether it excludes an entry, and the
 * distinct entries it removed for the one count note.
 */
export type ResultRemoval = {
  /** Whether the call excludes the entry at this URL. */
  readonly removes: (url: string) => boolean;
  /** Counts one removed result or citation; a copy in answer text is not one. */
  readonly count: (url: string) => void;
  /** The distinct entries removed so far; the note never names one. */
  readonly removedCount: () => number;
};

/**
 * Builds one call's removal rule over canonical URLs: a `read` reject clause
 * that matches the URL, and a `-site:` host of the query the URL belongs to,
 * subdomains included. Only a reject clause removes an entry through the
 * policy. A missing `read` allow, a whole-tool `read` reject, and the effective
 * `bypass` mode keep it: that half filters on what `read` refuses, it never
 * decides whether `read` may fetch a URL. The `-site:` half is the query's own
 * promise, so it holds in every mode. Each URL is decided once per call, and
 * the aggregate's second pass reuses the decisions its children made.
 */
export function createResultRemoval(
  context: ToolContext,
  excludedHosts: ReadonlyArray<string>,
): ResultRemoval {
  const hosts = excludedHosts.flatMap((host) => {
    const hostname = URL.parse(`http://${host}`)?.hostname;
    return hostname === undefined ? [] : [hostname.replace(/\.$/u, '')];
  });
  const decided = new Map<string, boolean>();
  const counted = new Set<string>();
  return {
    removes: (url) => {
      const key = canonicalUrl(url) ?? url;
      const cached = decided.get(key);
      if (cached !== undefined) return cached;
      // The key is canonical when `canonicalUrl` accepts the URL; its fallback
      // is raw text, which can still carry a root dot an exclusion drops.
      const host = URL.parse(key)?.hostname.replace(/\.$/u, '');
      const excluded =
        host !== undefined &&
        hosts.some(
          (candidate) => host === candidate || host.endsWith(`.${candidate}`),
        );
      const decision = evaluateWebLocatorRead(context, key);
      const rejected =
        decision?.decision === 'reject' &&
        decision.reference?.clauseIndex != null;
      const removed = excluded || rejected;
      decided.set(key, removed);
      return removed;
    },
    count: (url) => {
      counted.add(canonicalUrl(url) ?? url);
    },
    removedCount: () => counted.size,
  };
}
