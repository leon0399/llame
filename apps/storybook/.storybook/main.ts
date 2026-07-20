import type { StorybookConfig } from "@storybook/nextjs-vite";

const config: StorybookConfig = {
  framework: "@storybook/nextjs-vite",
  stories: ["../../../packages/ui/src/**/*.stories.@(ts|tsx)"],
  addons: [
    "@storybook/addon-docs",
    "@storybook/addon-a11y",
    "@storybook/addon-vitest",
    "@storybook/addon-mcp",
  ],
  typescript: {
    reactDocgen: "react-docgen-typescript",
    reactDocgenTypescriptOptions: {
      include: ["../../../packages/ui/src/**/*.tsx"],
    },
  },
  viteFinal: (config) => {
    // Pre-bundle deps that only a single story file pulls in. Without this,
    // Vite discovers them mid-run the first time that story loads on a cold
    // cache (fresh CI), triggers a dep re-optimization, and the reload leaves a
    // stale React copy — surfacing as "Invalid hook call" in the browser-mode
    // Vitest project (seen on sonner and the RHF-based form stories). Listing
    // them here forces the pre-bundle up front so the reload never happens.
    // They are declared as this package's devDependencies so the bare
    // specifiers resolve under pnpm's isolated node_modules.
    config.optimizeDeps ??= {};
    config.optimizeDeps.include = [
      ...(config.optimizeDeps.include ?? []),
      "sonner",
      "next-themes",
      "react-hook-form",
      "zod",
      "@hookform/resolvers/zod",
    ];
    return config;
  },
};

export default config;
