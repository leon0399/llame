import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { MessageResponse } from "./message.js";

// The regex tester has no docs example to transcribe — it is a llame
// feature (modeled on Linear's regex tester) woven through MessageResponse:
// a remark pass wraps prose/inline-code literals, the Shiki wrapper marks
// code-block literals, and RegexTesterProvider hosts the shared menu/tester
// popover. Stories therefore render MessageResponse with markdown content,
// the way chat messages reach the feature in the app.
const meta = {
  title: "ai-elements/RegexTester",
  component: MessageResponse,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof MessageResponse>;

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
    const results = within(matchLabel.parentElement as HTMLElement);
    await expect(results.getByText("1")).toBeVisible();
    await expect(results.getByText("22")).toBeVisible();
    await waitFor(() => {
      expect(document.querySelectorAll("mark").length).toBe(2);
    });
  },
};
