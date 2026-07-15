import type { Preview } from "@storybook/nextjs-vite";

import "@workspace/ui/globals.css";

const preview: Preview = {
  globalTypes: {
    theme: {
      description: "Global theme for components",
      toolbar: {
        icon: "mirror",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
      },
    },
  },
  initialGlobals: {
    theme: "light",
  },
  decorators: [
    (Story, context) => (
      <div className={context.globals.theme === "dark" ? "dark" : undefined}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    a11y: { test: "error" },
  },
};

export default preview;
