"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState } from "react";
import { registerApiQueryClient } from "@/lib/api/client";

export const ReactQueryClientProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [queryClient] = useState(() => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          // With SSR, we usually want to set some default staleTime
          // above 0 to avoid refetching immediately on the client
          staleTime: 60 * 1000,
        },
      },
    });
    // Browser-only: the module-level client backs the 401 handler, which only
    // runs client-side. Registering during SSR would set a process-global
    // QueryClient shared across requests (cross-tenant state-pollution risk).
    if (typeof window !== "undefined") {
      registerApiQueryClient(client);
    }
    return client;
  });
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
};
