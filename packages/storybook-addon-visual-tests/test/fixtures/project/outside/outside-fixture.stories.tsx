import type { Meta, StoryObj } from "@storybook/react-vite";

function OutsideFixture() {
  return (
    <main
      style={{
        width: 120,
        height: 80,
        background: "rgb(120, 80, 200)",
      }}
    >
      Outside story roots
    </main>
  );
}

const meta = {
  title: "Outside Fixture",
  component: OutsideFixture,
} satisfies Meta<typeof OutsideFixture>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
