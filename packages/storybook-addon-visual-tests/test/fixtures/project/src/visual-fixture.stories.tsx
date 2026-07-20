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
