export type SiteFilters = {
  readonly query: string;
  include: Array<string>;
  exclude: Array<string>;
};

/** Remove whitespace-delimited site operators while preserving their hosts. */
export function splitSiteFilters(query: string): SiteFilters {
  const include: Array<string> = [];
  const exclude: Array<string> = [];
  const remaining = query
    .trim()
    .split(/\s+/)
    .filter((token) => {
      const match = /^(site:|-site:)(\S+)$/i.exec(token);
      if (match === null) return true;
      (match[1].startsWith('-') ? exclude : include).push(match[2]);
      return false;
    });
  return { query: remaining.join(' '), include, exclude };
}
