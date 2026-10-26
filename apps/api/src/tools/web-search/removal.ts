import { type ToolContext } from '../types';
import { evaluateWebLocatorRead } from '../web-read/admission';

/**
 * One call's entry removal rule: what it excludes, and the distinct entries it
 * removed so far for the one count note.
 */
export type ResultRemoval = {
  /** Whether the call removes the entry at this URL. */
  readonly removes: (url: string) => boolean;
  /** The distinct entries removed so far; the note never names one. */
  readonly removedCount: () => number;
};

/**
 * Builds one call's removal rule: a `read` reject clause that matches the URL,
 * and a `-site:` host of the query the URL belongs to, subdomains included.
 * Only a reject clause removes an entry. A missing `read` allow, a whole-tool
 * `read` reject, and the effective `bypass` mode keep it: the rule filters the
 * search, it never decides whether `read` may fetch a URL. Each removed URL is
 * remembered, so an answer's link, its target, and its citation are one entry.
 */
export function createResultRemoval(
  context: ToolContext,
  excludedHosts: ReadonlyArray<string>,
): ResultRemoval {
  const hosts = excludedHosts.map((host) => host.toLowerCase());
  const removed = new Set<string>();
  return {
    removes: (url) => {
      const host = URL.canParse(url) ? new URL(url).hostname : undefined;
      const excluded =
        host !== undefined &&
        hosts.some(
          (candidate) => host === candidate || host.endsWith(`.${candidate}`),
        );
      if (!excluded) {
        // A whole-tool reject and a missing allow carry no clause index, and
        // only a clause may remove an entry.
        const decision = evaluateWebLocatorRead(context, url);
        const rejected =
          decision?.decision === 'reject' &&
          decision.reference?.clauseIndex != null;
        if (!rejected) return false;
      }
      removed.add(url);
      return true;
    },
    removedCount: () => removed.size,
  };
}
