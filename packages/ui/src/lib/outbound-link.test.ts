import { describe, expect, it } from "vitest";

import {
  OUTBOUND_LINK_TAG,
  isOutboundHref,
  rehypeOutboundLinks,
} from "./outbound-link.js";

const APP = "https://app.example";

describe("isOutboundHref", () => {
  it("marks a different http(s) origin as outbound", () => {
    expect(isOutboundHref("https://example.com/docs", APP)).toBe(true);
    expect(isOutboundHref("http://example.com/docs", APP)).toBe(true);
    expect(isOutboundHref("HTTPS://example.com/docs", APP)).toBe(true);
  });

  it("marks mailto and tel as outbound", () => {
    expect(isOutboundHref("mailto:owner@example.com", APP)).toBe(true);
    expect(isOutboundHref("tel:+15551212", APP)).toBe(true);
    expect(isOutboundHref("mailto:owner@example.com", "")).toBe(true);
  });

  it("leaves same-origin, fragment, and relative hrefs unmarked", () => {
    expect(isOutboundHref("https://app.example/settings", APP)).toBe(false);
    expect(isOutboundHref("https://APP.EXAMPLE/settings", APP)).toBe(false);
    expect(isOutboundHref("https://app.example:443/settings", APP)).toBe(false);
    expect(isOutboundHref("https://app.example/settings#account", APP)).toBe(
      false,
    );
    expect(isOutboundHref("//app.example/settings", APP)).toBe(false);
    expect(isOutboundHref("/settings", APP)).toBe(false);
    expect(isOutboundHref("?tab=usage", APP)).toBe(false);
    expect(isOutboundHref("#section", APP)).toBe(false);
    expect(isOutboundHref("#section", "")).toBe(false);
  });

  it("leaves hrefs that do not parse, and non-web schemes other than mailto and tel, unmarked", () => {
    expect(isOutboundHref("http://%5B", APP)).toBe(false);
    expect(isOutboundHref("http://[", APP)).toBe(false);
    expect(isOutboundHref("", APP)).toBe(false);
    expect(isOutboundHref("javascript:alert(1)", APP)).toBe(false);
    expect(isOutboundHref("ftp://files.example/a", APP)).toBe(false);
    expect(isOutboundHref("streamdown:incomplete-link", APP)).toBe(false);
  });

  it("treats absolute urls as outbound while the page origin is unknown", () => {
    expect(isOutboundHref("https://example.com/docs", "")).toBe(true);
    expect(isOutboundHref("  https://example.com/docs", "")).toBe(true);
    expect(isOutboundHref("//evil.example/a", "")).toBe(true);
    expect(isOutboundHref("/settings", "")).toBe(false);
    expect(isOutboundHref("#section", "")).toBe(false);
  });

  it("marks a different port, protocol, or scheme-relative host as outbound", () => {
    expect(isOutboundHref("https://app.example:444/settings", APP)).toBe(true);
    expect(isOutboundHref("http://app.example/settings", APP)).toBe(true);
    expect(isOutboundHref("//evil.example/a", APP)).toBe(true);
  });
});

describe("rehypeOutboundLinks", () => {
  type Node = {
    type: string;
    tagName?: string;
    value?: string;
    properties?: { href?: string };
    children?: Array<Node>;
  };

  const anchor = (href: string | undefined, label: string): Node => ({
    type: "element",
    tagName: "a",
    properties: href === undefined ? {} : { href },
    children: [{ type: "text", value: label }],
  });

  const labels = (node: Node | undefined) =>
    node?.children?.map((child) =>
      child.type === "text" ? child.value : child.tagName,
    );

  it("appends the marker only to outbound anchors, after their label", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "p",
          properties: {},
          children: [
            anchor("https://example.com/docs", "Docs"),
            anchor("/settings", "Settings"),
            anchor("#section", "Section"),
            anchor("http://[", "Broken"),
            anchor("mailto:owner@example.com", "Email"),
            anchor(undefined, "Stripped"),
          ],
        },
      ],
    };

    rehypeOutboundLinks({ ownOrigin: APP })(tree);

    const links = tree.children[0]?.children ?? [];
    expect(labels(links[0])).toEqual(["Docs", OUTBOUND_LINK_TAG]);
    expect(labels(links[1])).toEqual(["Settings"]);
    expect(labels(links[2])).toEqual(["Section"]);
    expect(labels(links[3])).toEqual(["Broken"]);
    expect(labels(links[4])).toEqual(["Email", OUTBOUND_LINK_TAG]);
    expect(labels(links[5])).toEqual(["Stripped"]);
  });

  it("marks absolute links when the page origin is unknown and leaves relative ones", () => {
    const tree = {
      type: "root",
      children: [
        anchor("https://example.com/docs", "Docs"),
        anchor("/settings", "Settings"),
      ],
    };

    rehypeOutboundLinks({ ownOrigin: "" })(tree);

    expect(labels(tree.children[0])).toEqual(["Docs", OUTBOUND_LINK_TAG]);
    expect(labels(tree.children[1])).toEqual(["Settings"]);
  });
});
