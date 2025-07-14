"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"
import { Toaster } from "@workspace/ui/components/sonner"
import { ReactQueryClientProvider } from "./providers/react-query-client-provider";
import { AppearanceProvider } from "@/contexts/appearance-context";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      enableColorScheme
    >
      <AppearanceProvider>
        <ReactQueryClientProvider>
          {children}
          <Toaster />
        </ReactQueryClientProvider>
      </AppearanceProvider>
    </NextThemesProvider>
  )
}
