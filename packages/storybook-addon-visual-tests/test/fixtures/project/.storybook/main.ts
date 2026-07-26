import type { StorybookConfig } from "@storybook/react-vite";

const sourcePreset = import.meta.resolve("../../../../src/preset.ts");

const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../src/**/*.stories.tsx"],
  addons: [
    {
      name: sourcePreset,
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
