"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"
import { SessionProvider } from 'next-auth/react';
import { Toaster } from "@workspace/ui/components/sonner"
import { ReactQueryClientProvider } from "./providers/react-query-client-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      enableColorScheme
    >
      <ReactQueryClientProvider>
        {children}
        <Toaster />
      </ReactQueryClientProvider>
    </NextThemesProvider>
  )
}
