/** Hosts whose web page for a repository is `https://<host>/<path>`. A
 *  canonical remote has no scheme, so any other host — a self-hosted server,
 *  an ssh port — cannot be known to serve one, and gets no link. */
const FORGES = new Map([
  ["github.com", "GitHub"],
  ["gitlab.com", "GitLab"],
  ["bitbucket.org", "Bitbucket"],
  ["codeberg.org", "Codeberg"],
  ["git.sr.ht", "sourcehut"],
]);

/** The repository's page on a known forge, from its canonical remote: the
 *  forge's name, the page, and the repository's path there (`owner/name`),
 *  which is how people say a repository on a forge. */
export function forgePage(
  canonicalRemote: string | null | undefined,
): { name: string; url: string; slug: string } | undefined {
  if (canonicalRemote == null) return undefined;
  const slash = canonicalRemote.indexOf("/");
  if (slash === -1) return undefined;
  const name = FORGES.get(canonicalRemote.slice(0, slash));
  return name === undefined
    ? undefined
    : {
        name,
        url: `https://${canonicalRemote}`,
        slug: canonicalRemote.slice(slash + 1),
      };
}
