import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/** A React Query client tuned for tests: no retries, so failures resolve fast. */
export function newTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

/**
 * A `renderHook` wrapper that provides `queryClient` through the real
 * `QueryClientProvider`, the pattern in lib/services/org-units/mutations.test.ts.
 */
export function wrapperWithClient(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}
