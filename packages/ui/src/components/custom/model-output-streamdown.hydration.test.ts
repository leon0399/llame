// @vitest-environment jsdom

/**
 * Stories render in the browser only, so they never hydrate server HTML.
 * Streamdown memoizes its link on class, href, and source position, not
 * children; this is the render that proves a same-origin absolute URL loses
 * the icon once the page origin is known.
 */

import { createElement } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { act } from "react";
import { afterEach, expect, it } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

import { ModelOutputStreamdown } from "./model-output-streamdown.js";

const markdown = (origin: string) =>
  `[Home](${origin}/settings) and [Docs](https://example.com/docs)`;

const view = (origin: string) =>
  createElement(ModelOutputStreamdown, null, markdown(origin));

const linkNamed = (label: string) =>
  [...document.querySelectorAll('[data-streamdown="link"]')].find((node) =>
    node.textContent?.startsWith(label),
  );

afterEach(() => {
  document.body.replaceChildren();
});

it("drops the icon on a same-origin absolute URL after hydration", async () => {
  const origin = window.location.origin;
  const html = renderToString(view(origin));

  expect(html.split("opens in a new tab")).toHaveLength(3);

  const container = document.createElement("div");
  // safe-html: renderToString of ModelOutputStreamdown; React escapes the markdown text and the only markup is the renderer's own elements
  container.innerHTML = html;
  document.body.append(container);

  await act(async () => {
    hydrateRoot(container, view(origin));
  });

  const home = linkNamed("Home");
  const docs = linkNamed("Docs");
  expect(home?.querySelector("svg")).toBeNull();
  expect(home?.textContent).not.toContain("opens in a new tab");
  expect(docs?.querySelector("svg")).not.toBeNull();
  expect(docs?.textContent).toContain("opens in a new tab");
});
