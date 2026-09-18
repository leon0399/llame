import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { StorybookConfig } from "@storybook/nextjs-vite";

// Absolute path to apps/web, so its `@/…` alias resolves inside Storybook's
// Vite. Storybook is rooted in apps/storybook and otherwise has no knowledge of
// the web app's path mapping.
const webRoot = fileURLToPath(new URL("../../web", import.meta.url));

// Resolves packages installed for apps/web only (this package does not depend
// on the app's runtime libraries).
const resolveFromWeb = createRequire(path.join(webRoot, "package.json"));

const config: StorybookConfig = {
  // apps/web loads this configuration through the Vitest plugin for its own
  // story project, so a plain `pnpm --filter web test` would otherwise
  // prepare a telemetry request and write the session cache on every run.
  core: { disableTelemetry: true },
  framework: "@storybook/nextjs-vite",
  // Component stories live in packages/ui; page/meta-component stories (chat +
  // project list items, pinned rail) live co-located in apps/web. Scope the
  // web globs to app/ + components/ — a bare `apps/web/**` also traverses
  // apps/web/node_modules (Storybook's CLI template stories + a second
  // symlinked @workspace/ui copy), which duplicates React/ui and breaks the run.
  stories: [
    "../../../packages/ui/src/**/*.stories.@(ts|tsx)",
    "../../../apps/web/app/**/*.stories.@(ts|tsx)",
    "../../../apps/web/components/**/*.stories.@(ts|tsx)",
  ],
  addons: [
    "@storybook/addon-docs",
    "@storybook/addon-a11y",
    "@storybook/addon-vitest",
    "@storybook/addon-mcp",
    {
      name: "storyproof/preset",
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
    configurePreBundledStoryDeps(config);
    configureWebAlias(config, webRoot);
    configureBrowserNodeGlobals(config);
    return config;
  },
};

type ViteFinalConfig = Parameters<NonNullable<StorybookConfig["viteFinal"]>>[0];

// Pre-bundle deps that only a single story file pulls in. Without this,
// Vite discovers them mid-run the first time that story loads on a cold
// cache (fresh CI), triggers a dep re-optimization, and the reload leaves a
// stale React copy — surfacing as "Invalid hook call" in the browser-mode
// Vitest project (seen on sonner and the RHF-based form stories). Listing
// them here forces the pre-bundle up front so the reload never happens.
// They are declared as this package's devDependencies so the bare
// specifiers resolve under pnpm's isolated node_modules.
const preBundledStoryDeps = [
  "sonner",
  "next-themes",
  "react-hook-form",
  "zod",
  "@hookform/resolvers/zod",
  // apps/web stories render components whose data hooks pull in React Query.
  "@tanstack/react-query",
  // The chat transcript row imports the AI SDK; pinned to apps/web's copy by
  // `configurePreBundledStoryDeps` below.
  "ai",
  // AI Elements stories: Streamdown markdown (message/reasoning), the
  // reasoning collapsible's controllable-state hook, framer-motion (Shimmer),
  // and Conversation's stick-to-bottom. Declared as storybook devDeps too so
  // the bare specifiers resolve under pnpm's isolated node_modules.
  "streamdown",
  "@radix-ui/react-use-controllable-state",
  "motion/react",
  "use-stick-to-bottom",
  // Base UI primitives back the migrated @workspace/ui components. Vite
  // optimizes each subpath on first use, so listing the bare package isn't
  // enough — every un-pre-bundled subpath triggers a mid-run re-optimize
  // whose reload leaves a stale React copy ("Cannot read properties of null
  // (reading 'useMemo')"). Pre-bundle every subpath the migration touches.
  "@base-ui/react/accordion",
  "@base-ui/react/alert-dialog",
  "@base-ui/react/avatar",
  "@base-ui/react/button",
  "@base-ui/react/checkbox",
  "@base-ui/react/collapsible",
  "@base-ui/react/dialog",
  "@base-ui/react/field",
  "@base-ui/react/form",
  "@base-ui/react/input",
  "@base-ui/react/menu",
  "@base-ui/react/number-field",
  "@base-ui/react/popover",
  "@base-ui/react/preview-card",
  "@base-ui/react/radio",
  "@base-ui/react/merge-props",
  "@base-ui/react/scroll-area",
  "@base-ui/react/select",
  "@base-ui/react/use-render",
  "@base-ui/react/separator",
  "@base-ui/react/slider",
  "@base-ui/react/switch",
  "@base-ui/react/tabs",
  "@base-ui/react/toggle",
  "@base-ui/react/toggle-group",
  "@base-ui/react/tooltip",
];

function configurePreBundledStoryDeps(config: ViteFinalConfig): void {
  config.optimizeDeps ??= {};
  config.optimizeDeps.include = [
    ...(config.optimizeDeps.include ?? []),
    ...preBundledStoryDeps,
  ];

  // The chat transcript row (an apps/web component) imports `ai`, which is
  // installed for the app, not for this package. Pin the bare specifier to the
  // app's copy so the pre-bundle entry resolves here; otherwise Vite discovers
  // the SDK mid-run, re-optimizes, and the reload fails the first story run
  // against a cold cache.
  config.resolve ??= {};
  config.resolve.alias = [
    ...(Array.isArray(config.resolve.alias)
      ? config.resolve.alias
      : Object.entries(config.resolve.alias ?? {}).map(
          ([find, replacement]) => ({ find, replacement }),
        )),
    { find: /^ai$/, replacement: resolveFromWeb.resolve("ai") },
  ];
}

/**
 * Next aliases `@opentelemetry/api` to its bundled Node build (that alias is
 * what makes the AI SDK importable), and that build reads `__dirname` inside
 * a webpack guard Next itself shims. Vite's browser bundle has no such shim,
 * so a story that imports the AI SDK (any transcript/message component) dies
 * on the dep chunk. Define the same mock webpack uses for the web target.
 */
function configureBrowserNodeGlobals(config: ViteFinalConfig): void {
  config.define = { ...config.define, __dirname: '"/"' };
  config.optimizeDeps ??= {};
  config.optimizeDeps.esbuildOptions = {
    ...config.optimizeDeps.esbuildOptions,
    define: {
      ...config.optimizeDeps.esbuildOptions?.define,
      __dirname: '"/"',
    },
  };
}

function configureWebAlias(config: ViteFinalConfig, webRoot: string): void {
  config.resolve ??= {};

  // apps/web components import their siblings via the `@/…` alias; make it
  // resolve to the web app root. Regex form so it matches ONLY `@/…` and not
  // `@workspace/…` (a bare `"@"` string alias would greedily rewrite both).
  // Normalize any framework-provided alias (object or array) into array form
  // so existing entries are preserved. The record form's index signature
  // already types `replacement` as `string` — no cast needed.
  const existingAlias = config.resolve.alias;
  const aliasArray = Array.isArray(existingAlias)
    ? existingAlias
    : Object.entries(existingAlias ?? {}).map(([find, replacement]) => ({
        find,
        replacement,
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
}

export default config;
