/**
 * One predicate for "does this href leave llame?", shared by every transcript
 * surface that renders through `ModelOutputStreamdown`. A future llame-owned
 * link form opts out here.
 *
 * The rehype pass appends a marker inside the anchor. Streamdown's own `a`
 * renderer stays in place, so link-safety confirmation is unchanged.
 */

export const OUTBOUND_LINK_TAG = "outbound-link";

const ABSOLUTE_HTTP_URL = /^[a-z][a-z\d+.-]*:/i;

type HastProperties = {
  href?: string | number | boolean;
};

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: HastProperties;
  children?: Array<HastNode>;
};

const isHrefString = (
  value: string | number | boolean | undefined,
): value is string => typeof value === "string";

/**
 * Base used only while the page origin is unknown, so relative hrefs still
 * parse. It is not llame's origin: absolute URLs are classified from their
 * own origin, and relative ones never count as outbound.
 */
const UNKNOWN_ORIGIN_BASE = "https://llame.invalid";

const readHref = (node: HastNode): string | undefined => {
  const href = node.properties?.href;
  return isHrefString(href) ? href : undefined;
};

/**
 * A parseable `http(s)` URL whose origin is not `ownOrigin`, or a `mailto:` /
 * `tel:` URL. Same-origin hrefs, `#fragment` links, relative references, and
 * hrefs that do not parse are not outbound.
 *
 * Pass `window.location.origin` once it is known. Pass `""` during SSR and
 * hydration: absolute `http(s)` URLs are then outbound, so the server HTML
 * matches the first client render. The renderer remounts when the origin
 * becomes known, because Streamdown memoizes links without looking at their
 * children.
 */
export const isOutboundHref = (href: string, ownOrigin: string): boolean => {
  const trimmed = href.trim();
  if (trimmed.startsWith("#")) return false;

  let url: URL;
  try {
    url = new URL(trimmed, ownOrigin || UNKNOWN_ORIGIN_BASE);
  } catch {
    return false;
  }

  if (url.protocol === "mailto:" || url.protocol === "tel:") return true;
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (!ABSOLUTE_HTTP_URL.test(trimmed) && !trimmed.startsWith("//")) {
    return false;
  }
  return url.origin !== ownOrigin;
};

const outboundLinkElement = (): HastNode => ({
  type: "element",
  tagName: OUTBOUND_LINK_TAG,
  properties: {},
  children: [],
});

const decorateOutboundLinks = (node: HastNode, ownOrigin: string): void => {
  if (node.tagName === "a" && node.children) {
    const href = readHref(node);
    if (href !== undefined && isOutboundHref(href, ownOrigin)) {
      node.children.push(outboundLinkElement());
    }
    return;
  }

  if (!node.children) return;
  for (const child of node.children) decorateOutboundLinks(child, ownOrigin);
};

/** Append `<outbound-link>` to anchors that leave llame. Run after sanitize. */
export const rehypeOutboundLinks =
  (options: { ownOrigin: string }) => (tree: HastNode) => {
    decorateOutboundLinks(tree, options.ownOrigin);
  };
