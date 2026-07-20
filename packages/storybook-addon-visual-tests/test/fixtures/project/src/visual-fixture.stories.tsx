import { useState } from "react";
import { createPortal } from "react-dom";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

function VisualFixture() {
  const [ready, setReady] = useState(false);
  return (
    <main
      style={{
        width: "100vw",
        height: "100vh",
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
                right: 24,
                bottom: 24,
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
  play: async ({ canvas, canvasElement }) => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await userEvent.click(canvas.getByRole("button", { name: "Finish story" }));
    await expect(
      within(canvasElement.ownerDocument.body).getByText("Portal ready"),
    ).toBeVisible();
  },
};
