import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";

import { ModelOutputStreamdown } from "./model-output-streamdown.js";

const meta = {
  component: ModelOutputStreamdown,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof ModelOutputStreamdown>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Assistant text, the owner's own message, reasoning, and `web_search`
 * results all render through this component. An outbound link — another
 * origin, or `mailto:` / `tel:` — carries a trailing outwards icon and an
 * accessible name that says it opens in a new tab. A same-origin path and a
 * `#fragment` stay plain. A href that does not parse is blocked before it
 * becomes a link, and shows no icon. The icon is decorative; confirming the
 * click still opens Streamdown's external-link dialog.
 *
 * @summary for outbound links marked before the click, and in-app links left plain
 */
export const OutboundLinks: Story = {
  tags: ["ai-generated"],
  args: {
    children:
      "[Docs](https://example.com/docs), [Email](mailto:owner@example.com), [Phone](tel:+15551212), [Settings](/settings), [Section](#section), and [Broken](http://%5B).",
  },
  play: async ({ canvas, userEvent }) => {
    const docs = await canvas.findByRole("button", {
      name: "Docs opens in a new tab",
    });
    const email = canvas.getByRole("button", {
      name: "Email opens in a new tab",
    });
    const phone = canvas.getByRole("button", {
      name: "Phone opens in a new tab",
    });
    const settings = canvas.getByRole("button", { name: "Settings" });
    const section = canvas.getByRole("button", { name: "Section" });
    const broken = canvas.getByText(/Broken/);

    for (const link of [docs, email, phone]) {
      const icon = link.querySelector("svg");
      await expect(icon).not.toBeNull();
      await expect(icon).toHaveAttribute("aria-hidden", "true");
      await expect(icon).toHaveClass("size-3");
      await expect(icon).not.toHaveAttribute("tabindex");
      await expect(within(link).queryByRole("img")).toBeNull();
      await expect(link.querySelector(".sr-only")).toHaveTextContent(
        "opens in a new tab",
      );
      await expect(link).not.toHaveAttribute("aria-label");
    }

    for (const link of [settings, section]) {
      await expect(link.querySelector("svg")).toBeNull();
      await expect(link.querySelector(".sr-only")).toBeNull();
    }
    await expect(broken.closest("button")).toBeNull();
    await expect(broken.closest("a")).toBeNull();
    await expect(broken.querySelector("svg")).toBeNull();

    await userEvent.click(docs);
    await expect(canvas.getByText("Open external link?")).toBeVisible();
    await expect(
      canvas.getByText("You're about to visit an external website."),
    ).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect(
      canvas.queryByText("Open external link?"),
    ).not.toBeInTheDocument();

    await userEvent.click(settings);
    await expect(canvas.getByText("Open external link?")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect(
      canvas.queryByText("Open external link?"),
    ).not.toBeInTheDocument();
  },
};
