import { fileURLToPath } from "node:url";

import type { StorybookConfig } from "@storybook/nextjs-vite";

// Absolute path to apps/web, so its `@/…` alias resolves inside Storybook's
// Vite. Storybook is rooted in apps/storybook and otherwise has no knowledge of
// the web app's path mapping.
const webRoot = fileURLToPath(new URL("../../web", import.meta.url));

const config: StorybookConfig = {
  framework: "@storybook/nextjs-vite",
  // Component stories live in packages/ui; page/meta-component stories (chat +
  // project list items, pinned rail) live co-located in apps/web. Scope the
  // web globs to app/ + components/ — a bare `apps/web/**` also traverses
  // apps/web/node_modules (Storybook's CLI template stories + a second
  // symlinked @workspace/ui copy), which duplicates React/ui and breaks the run.
  // The visual-tests addon ships its own manager stories too.
  stories: [
    "../../../packages/ui/src/**/*.stories.@(ts|tsx)",
    "../../../apps/web/app/**/*.stories.@(ts|tsx)",
    "../../../apps/web/components/**/*.stories.@(ts|tsx)",
    "../../../packages/storybook-addon-visual-tests/src/**/*.stories.@(ts|tsx)",
  ],
  addons: [
    "@storybook/addon-docs",
    "@storybook/addon-a11y",
    "@storybook/addon-vitest",
    "@storybook/addon-mcp",
    {
      name: "@workspace/storybook-addon-visual-tests/preset",
      options: {
        // Both story sources Storybook loads: the component library and the
        // co-located apps/web page/meta stories. A story outside every root
        // fails capture, so keep this in step with the `stories` globs above.
        storyRoots: ["../../packages/ui/src", "../../apps/web"],
      },
    },
  ],
  typescript: {
    reactDocgen: "react-docgen-typescript",
    reactDocgenTypescriptOptions: {
      include: [
        "../../../packages/ui/src/**/*.tsx",
        "../../../apps/web/app/**/*.tsx",
        "../../../apps/web/components/**/*.tsx",
      ],
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
      // apps/web stories render components whose data hooks pull in React Query.
      "@tanstack/react-query",
    ];

    config.resolve ??= {};

    // apps/web components import their siblings via the `@/…` alias; make it
    // resolve to the web app root. Regex form so it matches ONLY `@/…` and not
    // `@workspace/…` (a bare `"@"` string alias would greedily rewrite both).
    // Normalize any framework-provided alias (object or array) into array form
    // so existing entries are preserved.
    const existingAlias = config.resolve.alias;
    const aliasArray = Array.isArray(existingAlias)
      ? existingAlias
      : Object.entries(existingAlias ?? {}).map(([find, replacement]) => ({
          find,
          replacement: replacement as string,
        }));
    config.resolve.alias = [
      ...aliasArray,
      { find: /^@\//, replacement: `${webRoot}/` },
    ];

    // The QueryClientProvider (from Storybook's @tanstack/react-query) and the
    // web components' hooks (from web's copy) must resolve to ONE module
    // instance, or the provider's context never reaches the hooks
    // ("No QueryClient set"). Force a single copy.
    config.resolve.dedupe = [
      ...(config.resolve.dedupe ?? []),
      "@tanstack/react-query",
    ];

    return config;
  },
};

export default config;
