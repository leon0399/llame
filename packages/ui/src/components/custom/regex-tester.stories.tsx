import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { ModelOutputStreamdown } from "./model-output-streamdown.js";

// The regex tester has no docs example to transcribe — it is a llame
// feature (modeled on Linear's regex tester) woven through ModelOutputStreamdown:
// a remark pass wraps prose/inline-code literals, the Shiki wrapper marks
// code-block literals, and RegexTesterProvider hosts the shared menu/tester
// popover. Stories therefore render the complete composition root with markdown content,
// the way chat messages reach the feature in the app.
const meta = {
  component: ModelOutputStreamdown,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof ModelOutputStreamdown>;

export default meta;

type Story = StoryObj<typeof meta>;

const SLUG_LITERAL = "/^[a-z0-9]+(?:-[a-z0-9]+)*$/";

/**
 * A regex literal in plain prose gets the dotted-underline affordance: it
 * renders as an inline button carrying `data-regex-token`, ready to open the
 * tester.
 *
 * @summary for the underlined regex affordance in prose
 */
export const ProseLiteral: Story = {
  tags: ["ai-generated"],
  args: {
    children: `Slugs must match ${SLUG_LITERAL} before saving.`,
  },
  play: async ({ canvas, canvasElement }) => {
    const token = await canvas.findByRole("button", { name: SLUG_LITERAL });
    await expect(token).toHaveAttribute("data-regex-token", SLUG_LITERAL);
    // The literal's `*` must not leave emphasis artifacts (mangled text or a
    // stray remend-appended delimiter) around the restored paragraph.
    await expect(canvasElement.querySelector("p")).toHaveTextContent(
      `Slugs must match ${SLUG_LITERAL} before saving.`,
    );
  },
};

/**
 * A literal inside inline code keeps its `<code>` styling while the literal
 * itself becomes the interactive token — the way models usually quote
 * patterns in chat. Detection reads the raw code span, so escapes like `\d`
 * and `\.` survive exactly as written.
 *
 * @summary for a regex literal inside inline code
 */
export const InlineCodeLiteral: Story = {
  tags: ["ai-generated"],
  args: {
    children: "Split on `/\\d+\\.\\d+/` to find version numbers.",
  },
  play: async ({ canvas }) => {
    const token = await canvas.findByRole("button", {
      name: "/\\d+\\.\\d+/",
    });
    await expect(token.closest("code")).not.toBeNull();
  },
};

/**
 * Inside a fenced code block the Shiki tokens covering a literal are marked
 * and dotted-underlined (keeping their syntax colors), while non-regex
 * slashes on other lines — division, comments — stay untouched.
 *
 * @summary for underlined regex literals inside a highlighted code block
 */
export const CodeBlockLiteral: Story = {
  tags: ["ai-generated"],
  args: {
    children:
      "```ts\n" +
      "export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;\n" +
      "// Not a regex: the tester leaves division alone.\n" +
      "const ratio = width / height / 2;\n" +
      "```",
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const marked = canvasElement.querySelectorAll("[data-regex-token]");
      expect(marked.length).toBeGreaterThan(0);

      const sources = new Set(
        [...marked].map((span) => span.getAttribute("data-regex-token")),
      );
      expect([...sources]).toEqual([SLUG_LITERAL]);

      // The marked spans must cover the literal *exactly*: a literal spans
      // several Shiki tokens, so decoration that split or skipped one of them
      // would still report the right source above while underlining less
      // than the whole literal — or more of the line than belongs to it.
      expect([...marked].map((span) => span.textContent).join("")).toBe(
        SLUG_LITERAL,
      );

      for (const span of marked) {
        expect(span.textContent).not.toContain("height");
      }
    });
  },
};

/**
 * Precision guard: slashes that are not regex literals — division, file
 * paths, URLs, dates, `and/or` — get no affordance at all.
 *
 * @summary for prose slashes that must stay plain
 */
export const NotARegex: Story = {
  tags: ["ai-generated"],
  args: {
    children:
      "Check /home/user/projects and https://example.com/path on " +
      "01/02/2026, then compute width / height / 2 and/or retry.",
  },
  play: async ({ canvasElement }) => {
    await expect(
      canvasElement.querySelectorAll("[data-regex-token]").length,
    ).toBe(0);
  },
};

/**
 * Regression: the source-level rewrite must never change what a message
 * says. Here the literal's own `*` opens an emphasis that swallows a second,
 * nested one — flattening that run would print the nested delimiters as
 * literal asterisks and drop the outer closing one. The rewrite backs off
 * instead: no underline, but the prose renders exactly as CommonMark parsed
 * it.
 *
 * @summary for prose that must not be rewritten at all
 */
export const NestedEmphasisLeftIntact: Story = {
  tags: ["ai-generated"],
  args: { children: "A /p*q/ mid *word*pair* end." },
  play: async ({ canvas, canvasElement }) => {
    const paragraph = await canvas.findByText(/end\./);
    // `*` at offsets 4 and 22 pair as one emphasis wrapping the `*word*` one,
    // so CommonMark consumes all four delimiters.
    await expect(paragraph).toHaveTextContent("A /pq/ mid wordpair end.");
    await expect(
      canvasElement.querySelectorAll("[data-regex-token]").length,
    ).toBe(0);
  },
};

/**
 * Markdown allows raw HTML, and models use it. Those blocks reach the tree as
 * one opaque `html` node, so the source-level pass never sees inside them —
 * the hast pass does, after `rehype-raw` has parsed them into real elements.
 *
 * @summary for regex literals inside raw HTML blocks
 */
export const HtmlBlockLiterals: Story = {
  tags: ["ai-generated"],
  args: {
    children:
      '<section id="regex-section">\n' +
      "  Text before a regex: /\\b(?:GET|POST)\\b/.\n" +
      "</section>\n\n" +
      "<details>\n" +
      // A named group has to be written `&lt;user&gt;` inside raw HTML —
      // unescaped, `<user>` is a tag to any HTML parser and the literal is
      // destroyed before rendering, so there is nothing correct to underline.
      "  <summary>In a summary: /^(?&lt;user&gt;[a-z0-9_]+)@\\S+$/i</summary>\n" +
      "  <p>In a paragraph: /^\\s*$/</p>\n" +
      "</details>\n\n" +
      "<table><tbody><tr>\n" +
      "  <td>In a cell</td><td>/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i</td>\n" +
      "</tr></tbody></table>\n",
  },
  play: async ({ canvas, canvasElement }) => {
    const sources = () =>
      [...canvasElement.querySelectorAll("[data-regex-token]")].map((span) =>
        span.getAttribute("data-regex-token"),
      );

    // The `<summary>` literal is deliberately absent: `summary` is itself an
    // interactive control, so a token inside it would nest one control in
    // another and its activation would fight the disclosure toggle.
    await waitFor(() =>
      expect(sources()).toEqual([
        String.raw`/\b(?:GET|POST)\b/`,
        String.raw`/^\s*$/`,
        "/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i",
      ]),
    );
    // Still fully interactive, not just decorated. Uses the `<section>`
    // literal — the `<details>` ones are inside a collapsed disclosure.
    await userEvent.click(
      canvas.getByRole("button", { name: "/\\b(?:GET|POST)\\b/" }),
    );
    const body = within(document.body);
    await userEvent.click(
      await body.findByRole("menuitem", { name: "Test regex" }),
    );
    await userEvent.type(
      await body.findByRole("textbox", { name: "Text to match" }),
      "GET",
    );
    await expect(await body.findByText("Match")).toBeVisible();
    await userEvent.keyboard("{Escape}");
  },
};

/**
 * Security regression: supplying `rehypePlugins` *replaces* Streamdown's
 * defaults, which are `rehype-raw` → `rehype-sanitize` → `rehype-harden`.
 * Forgetting to re-supply them would turn off sanitization outright while
 * everything still looked fine, so this pins that dangerous markup in a
 * message is still neutralized with the regex pass appended.
 *
 * @summary for sanitization surviving the appended rehype pass
 */
export const DangerousHtmlStillSanitized: Story = {
  tags: ["ai-generated"],
  args: {
    children:
      '<p onclick="alert(1)" data-evil="1">Handlers stripped: /^\\d+$/</p>\n\n' +
      '<p><a href="javascript:alert(1)">Unsafe link</a></p>\n\n' +
      "<script>alert(1)</script>\n\n" +
      '<iframe src="https://example.com"></iframe>\n',
  },
  play: async ({ canvas, canvasElement }) => {
    const paragraph = await canvas.findByText(/Handlers stripped/);
    // Both halves are asserted, because either one alone passes vacuously.
    // Raw HTML is really being parsed as markup — drop `rehype-raw` and
    // Streamdown renders every tag as visible text instead, which would make
    // the "no dangerous element" checks below true for the wrong reason.
    await expect(paragraph.tagName).toBe("P");
    await expect(canvasElement.textContent).not.toContain("<script>");
    // …and dangerous markup is still neutralized. Scope of this guard, tested
    // by deliberately breaking the merge: dropping the defaults entirely does
    // fail here, because Streamdown then renders every tag as text. It does
    // NOT isolate `rehype-sanitize` on its own — react-markdown's urlTransform
    // blocks `javascript:` hrefs and refuses to render `<script>` regardless,
    // so these payloads stay clean even without it.
    await expect(paragraph.hasAttribute("data-evil")).toBe(false);
    await expect(paragraph.hasAttribute("onclick")).toBe(false);
    const unsafeLink = canvasElement.querySelector("a");
    await expect(unsafeLink?.getAttribute("href") ?? "").not.toContain(
      "javascript:",
    );
    await expect(canvasElement.querySelector("script")).toBeNull();
    await expect(canvasElement.querySelector("iframe")).toBeNull();
    // The pass itself still ran on the surviving text.
    await expect(
      canvas.getByRole("button", { name: "/^\\d+$/" }),
    ).toBeInTheDocument();
  },
};

/**
 * Precision guard for HTML: a literal is only a token when it is *text*. In
 * an attribute, an HTML comment, or a `script`/`style` body it is data, not
 * prose — the hast pass only ever splits text nodes, so those are untouched.
 *
 * @summary for regex-looking content in HTML attributes and raw-text elements
 */
export const HtmlNonTextLiterals: Story = {
  tags: ["ai-generated"],
  args: {
    children:
      '<div data-pattern="/^\\d{4}-\\d{2}-\\d{2}$/">\n' +
      '  <span title="/^[a-z][a-z0-9_-]{2,31}$/i">Attribute only</span>\n' +
      "</div>\n\n" +
      "<!-- Comment with regex: /^\\d+$/ -->\n\n" +
      '<style>\n.x[data-pattern*="/^"] { color: red; }\n</style>\n',
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(await canvas.findByText(/Attribute only/)).toBeVisible();
    await expect(
      canvasElement.querySelectorAll("[data-regex-token]").length,
    ).toBe(0);
  },
};

/**
 * A literal spelling a character reference is testable, and what it tests is
 * what the reader sees. The source-level pass declines it — its token text is
 * raw source, which would show `&amp;` where markdown renders `&` — and the
 * hast pass then picks it up from the rendered text, where the two agree.
 *
 * @summary for a literal containing a character reference
 */
export const CharacterReferenceRendersDecoded: Story = {
  tags: ["ai-generated"],
  args: { children: "Match /foo&amp;bar+/ against input." },
  play: async ({ canvas }) => {
    const paragraph = await canvas.findByText(/against input/);
    await expect(paragraph).toHaveTextContent(
      "Match /foo&bar+/ against input.",
    );
    // Decoded in both places, so the tester compiles the pattern on screen.
    const token = canvas.getByRole("button", { name: "/foo&bar+/" });
    await expect(token).toHaveAttribute("data-regex-token", "/foo&bar+/");
  },
};

/**
 * Security regression: whitelisting `<regex-token>` through rehype-sanitize
 * also lets a model *write* one, since Streamdown parses raw HTML. The token
 * component re-runs detection on its own text, so markup alone never earns
 * the affordance — model output gains nothing it could not get by writing a
 * literal in plain prose.
 *
 * @summary for a model-authored regex-token tag
 */
export const ModelAuthoredTokenTagInert: Story = {
  tags: ["ai-generated"],
  args: {
    children:
      "<regex-token>not a regex at all</regex-token> and " +
      "<regex-token>/example.com/</regex-token> stay inert.",
  },
  play: async ({ canvas, canvasElement }) => {
    // The tags are live — rehype-raw parses them and the allowlist admits
    // them — so they reach the token component and are neutralized there,
    // leaving their text hoisted into the paragraph. Before the component
    // re-detected, both payloads rendered as underlined, data-carrying
    // tokens purely because the markup said so.
    const paragraph = await canvas.findByText(/stay inert/);
    await expect(paragraph.innerHTML).toBe(
      "not a regex at all and /example.com/ stay inert.",
    );
    // Neither payload is a detected literal — the first isn't one at all, the
    // second is the precision guard's own counter-example (a lone `.` is not
    // evidence of a pattern) — so neither renders as a token.
    await expect(
      canvasElement.querySelectorAll("[data-regex-token]").length,
    ).toBe(0);
    await expect(canvas.queryByRole("button")).toBeNull();
  },
};

/**
 * Regression: literals inside a GFM table must not break the table. The
 * remark pass supplies its own `remarkPlugins`, which *replaces* Streamdown's
 * defaults — forgetting to re-supply `defaultRemarkPlugins` silently turns
 * off GFM and renders every table as one pipe-filled paragraph (found via a
 * real chat message). Cell literals live in inline code and stay testable.
 *
 * @summary for regex literals inside a GFM table
 */
export const TableWithLiterals: Story = {
  tags: ["ai-generated"],
  args: {
    children:
      "| Context | Regex literal | Inputs to test |\n" +
      "|---|---|---|\n" +
      "| Whitespace | `/^\\s*$/` | Match a tab; reject ` x ` |\n" +
      "| Semver | `/^v?(\\d+)\\.(\\d+)\\.(\\d+)$/` | Match `1.2.3`; reject `1.2` |",
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(await canvas.findByRole("table")).toBeVisible();
    const token = canvas.getByRole("button", { name: "/^\\s*$/" });
    await expect(token.closest("td")).not.toBeNull();
    // No leftover pipe soup outside the table structure.
    await expect(canvasElement.querySelector("p")).toBeNull();

    // Regression: the tester must survive the table's fullscreen overlay —
    // the overlay stops bubble-phase clicks (capture-phase delegation) and
    // z-ties a body-portaled popover (portal into the overlay instead).
    const body = within(document.body);
    await userEvent.click(
      canvas.getByRole("button", { name: "View fullscreen" }),
    );
    const overlay = await body.findByRole("dialog", {
      name: "View fullscreen",
    });
    await userEvent.click(
      within(overlay).getAllByRole("button", { name: "/^\\s*$/" })[0],
    );
    const menuItem = await body.findByRole("menuitem", { name: "Test regex" });
    await expect(
      menuItem.closest('[data-streamdown="table-fullscreen"]'),
    ).not.toBeNull();
    await userEvent.click(menuItem);
    const input = await body.findByRole("textbox", { name: "Text to match" });
    await userEvent.type(input, "x");
    await expect(await body.findByText("No match")).toBeVisible();
    // Neither interaction closed the fullscreen view.
    await expect(overlay).toBeVisible();
    await userEvent.keyboard("{Escape}");
  },
};

/**
 * The full interaction: click the underlined literal → a single-option menu
 * ("Test regex") opens anchored to it → selecting it swaps to the live
 * tester → non-matching input reports "No match" → matching input highlights
 * the span inside the input, shows the check mark, and lists the value under
 * "Match" → Escape dismisses.
 *
 * @summary for the click → menu → live tester flow
 */
export const TestRegexFlow: Story = {
  tags: ["ai-generated"],
  args: {
    children: `Slugs must match ${SLUG_LITERAL} before saving.`,
  },
  play: async ({ canvas }) => {
    const body = within(document.body);

    const token = await canvas.findByRole("button", { name: SLUG_LITERAL });
    await userEvent.click(token);

    const menuItem = await body.findByRole("menuitem", {
      name: "Test regex",
    });
    await userEvent.click(menuItem);

    const input = await body.findByRole("textbox", { name: "Text to match" });
    await expect(input).toHaveFocus();

    await userEvent.type(input, "My-Slug");
    await expect(await body.findByText("No match")).toBeVisible();

    await userEvent.clear(input);
    await userEvent.type(input, "my-slug");

    const matchLabel = await body.findByText("Match");
    // SAFETY: `parentElement` is only null for a detached/root node; this
    // label is always rendered inside the tester's match-list container.
    const results = within(matchLabel.parentElement as HTMLElement);
    await expect(results.getByText("my-slug")).toBeVisible();
    await waitFor(() => {
      const highlight = document.querySelector("mark");
      expect(highlight).not.toBeNull();
      expect(highlight).toHaveTextContent("my-slug");
    });

    await userEvent.keyboard("{Escape}");
    await waitFor(() => {
      expect(body.queryByRole("textbox", { name: "Text to match" })).toBeNull();
    });
  },
};

/**
 * A global-flag literal highlights every match in the tester input and lists
 * each matched value under "Match", not just the first.
 *
 * @summary for multiple matches with a global flag
 */
export const GlobalFlagMatches: Story = {
  tags: ["ai-generated"],
  args: {
    children: "Digit runs: /\\d+/g",
  },
  play: async ({ canvas }) => {
    const body = within(document.body);

    await userEvent.click(
      await canvas.findByRole("button", { name: "/\\d+/g" }),
    );
    await userEvent.click(
      await body.findByRole("menuitem", { name: "Test regex" }),
    );

    const input = await body.findByRole("textbox", { name: "Text to match" });
    await userEvent.type(input, "a1 b22");

    const matchLabel = await body.findByText("Match");
    // SAFETY: `parentElement` is only null for a detached/root node; this
    // label is always rendered inside the tester's match-list container.
    const results = within(matchLabel.parentElement as HTMLElement);
    await expect(results.getByText("1")).toBeVisible();
    await expect(results.getByText("22")).toBeVisible();
    await waitFor(() => {
      expect(document.querySelectorAll("mark").length).toBe(2);
    });
  },
};
