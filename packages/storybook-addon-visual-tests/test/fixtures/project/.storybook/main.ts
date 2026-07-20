import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../src/**/*.stories.tsx"],
  addons: [
    {
      name: "@workspace/storybook-addon-visual-tests/preset",
      options: { storyRoots: ["test/.tmp/project/src"] },
    },
  ],
  viteFinal: (config) => {
    config.optimizeDeps ??= {};
    config.optimizeDeps.include = [
      ...(config.optimizeDeps.include ?? []),
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "react-dom/client",
    ];
    return config;
  },
};

export default config;
