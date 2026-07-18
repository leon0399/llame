import type { Preview } from "@storybook/nextjs-vite";
import { type ReactNode, useEffect } from "react";

import "./preview.css";

function ThemeClass({
  theme,
  children,
}: {
  theme: string;
  children: ReactNode;
}) {
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");

    return () => document.documentElement.classList.remove("dark");
  }, [theme]);

  return children;
}

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
      <ThemeClass theme={context.globals.theme}>
        <Story />
      </ThemeClass>
    ),
  ],
  parameters: {
    a11y: { test: "error" },
  },
};

export default preview;
