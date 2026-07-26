import { useState } from "react";
import { createPortal } from "react-dom";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

function VisualFixture() {
  const [ready, setReady] = useState(false);
  return (
    <main
      style={{
        width: 120,
        height: 80,
        background: ready ? "rgb(0, 180, 90)" : "rgb(200, 30, 30)",
      }}
    >
      <button type="button" onClick={() => setReady(true)}>
        Finish story
      </button>
      {ready
        ? createPortal(
            <aside
              style={{
                position: "fixed",
                left: 280,
                top: 160,
                width: 180,
                height: 100,
                background: "rgb(20, 80, 220)",
                color: "white",
              }}
            >
              Portal ready
            </aside>,
            document.body,
          )
        : null}
    </main>
  );
}

const meta = {
  title: "Visual Fixture",
  component: VisualFixture,
} satisfies Meta<typeof VisualFixture>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Changed: Story = {};

export const Stale: Story = {};

export const Malformed: Story = {};

export const Viewport: Story = {
  parameters: { layout: "fullscreen" },
};

export const Disabled: Story = {
  parameters: { visualTests: { disable: true } },
};

export const Controlled: Story = {
  play: async () => {
    const response = await fetch("/control/state.json", {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(
        `Could not read visual fixture control state: ${response.status} ${response.statusText}`,
      );
    }

    const state: unknown = await response.json();
    const control =
      typeof state === "object" && state !== null ? state : undefined;
    const mode =
      control && "mode" in control && typeof control.mode === "string"
        ? control.mode
        : undefined;

    switch (mode) {
      case "ready":
        return;
      case "hang":
        await new Promise<never>(() => undefined);
        return;
      case "connection-failure": {
        const url =
          control &&
          "url" in control &&
          typeof control.url === "string" &&
          control.url.length > 0
            ? control.url
            : undefined;
        if (!url) {
          throw new Error(
            "Visual fixture connection-failure mode requires a non-empty url string",
          );
        }

        let destination: URL;
        try {
          destination = new URL(url);
        } catch {
          throw new Error(
            `Visual fixture connection-failure url must be an absolute URL: ${url}`,
          );
        }
        if (
          destination.protocol !== "http:" &&
          destination.protocol !== "https:"
        ) {
          throw new Error(
            `Visual fixture connection-failure url must use http or https: ${url}`,
          );
        }

        globalThis.location.assign(destination.href);
        await new Promise<never>(() => undefined);
        return;
      }
      default:
        throw new Error(`Unsupported visual fixture control mode: ${mode}`);
    }
  },
};

export const Portal: Story = {
  parameters: { layout: "centered" },
  play: async ({ canvas, canvasElement }) => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await userEvent.click(canvas.getByRole("button", { name: "Finish story" }));
    await expect(
      within(canvasElement.ownerDocument.body).getByText("Portal ready"),
    ).toBeVisible();
  },
};
