import type { Preview } from "@storybook/nextjs-vite";
import { type ReactNode, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { sb } from "storybook/test";

import "./preview.css";

// Register module mocks (project-level only, per Storybook "Mocking modules").
// Paths are relative to THIS file, with extension, no alias.
// - active-runs-context: the real provider fetches/polls runs and
//   `useActiveRuns` throws outside it; the mock is a controllable spy so
//   apps/web sidebar stories can drive the status dots without a backend.
// - pins/mutations: keeps pin/unpin off the network and exposes assertable
//   `mutate` spies for the interaction stories.
sb.mock(import("../../web/contexts/active-runs-context.tsx"));
sb.mock(import("../../web/lib/services/pins/mutations.ts"));

// One QueryClient shared across stories (retry off so any mutation/query hook
// in an apps/web component doesn't hammer a nonexistent backend), cleared
// between stories. Display stories don't seed data — the hooks only need a
// client in context to construct their mutations.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

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
  beforeEach: () => {
    // Fresh query state per story.
    queryClient.clear();
  },
  decorators: [
    (Story, context) => (
      <QueryClientProvider client={queryClient}>
        <ThemeClass theme={context.globals.theme}>
          <Story />
        </ThemeClass>
      </QueryClientProvider>
    ),
  ],
  parameters: {
    a11y: { test: "error" },
    // apps/web components use the App Router next/navigation; nextjs-vite
    // auto-mocks it. This makes usePathname/useRouter resolve for them; drive
    // the active row per story via `parameters.nextjs.navigation.pathname`.
    nextjs: { appDirectory: true },
  },
};

export default preview;
