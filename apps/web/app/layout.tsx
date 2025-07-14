import { Fira_Code, Geist, Geist_Mono, JetBrains_Mono, Open_Sans, Roboto, Roboto_Condensed, Roboto_Mono } from "next/font/google"

import "@workspace/ui/globals.css"

import { Providers } from "@/components/providers"
import { SessionProvider } from "next-auth/react"
import { auth } from "./(auth)/auth"
import { cn } from "@workspace/ui/lib/utils"
import { getFontCssVariables } from "@/lib/appearance/font/service"

const fontGeist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  fallback: ["system-ui", "sans-serif"],
})

const fontOpenSans = Open_Sans({
  subsets: ["latin"],
  variable: "--font-open-sans",
  weight: ["300", "400", "500", "700", "800"],
  display: "swap",
  style: ["normal"],
  fallback: ["system-ui", "sans-serif"],
})

const fontRoboto = Roboto({
  subsets: ["latin"],
  variable: "--font-roboto",
  weight: ["100", "300", "400", "500", "700", "900"],
  display: "swap",
  style: ["normal", "italic"],
  fallback: ["system-ui", "sans-serif"],
})

const fontRobotoCondensed = Roboto_Condensed({
  subsets: ["latin"],
  variable: "--font-roboto-condensed",
  weight: ["100", "300", "400", "500", "700", "900"],
  display: "swap",
  style: ["normal"],
  fallback: ["system-ui", "sans-serif"],
})

const fontGeistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  fallback: ["ui-monospace", "SFMono-Regular", "SF Mono", "Menlo", "monospace"],
})

const fontFiraCode = Fira_Code({
  subsets: ["latin"],
  variable: "--font-fira-code",
  fallback: ["ui-monospace", "SFMono-Regular", "SF Mono", "Menlo", "monospace"],
})

const fontJetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  fallback: ["ui-monospace", "SFMono-Regular", "SF Mono", "Menlo", "monospace"],
})

const fontRobotoMono = Roboto_Mono({
  subsets: ["latin"],
  variable: "--font-roboto-mono",
  weight: ["100", "300", "400", "500", "700"],
  display: "swap",
  style: ["normal", "italic"],
  fallback: ["ui-monospace", "SFMono-Regular", "SF Mono", "Menlo", "monospace"],
})

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const session = await auth();
  const fontCssVariables = await getFontCssVariables();

  return (
    <SessionProvider session={session}>
      <html 
        lang="en" 
        suppressHydrationWarning 
        className={cn(
          fontGeist.variable,
          fontOpenSans.variable,
          fontRoboto.variable,
          fontRobotoCondensed.variable,
          fontGeistMono.variable,
          fontFiraCode.variable,
          fontJetBrainsMono.variable,
          fontRobotoMono.variable,
        )}
      >
        <head>
          <style dangerouslySetInnerHTML={{
            __html: `
              :root {
                --font-sans: ${fontCssVariables['--font-sans']};
                --font-mono: ${fontCssVariables['--font-mono']};
              }
            `
          }} />
        </head>
        <body
          className={cn(
            'font-sans antialiased',
          )}
        >
          <Providers>{children}</Providers>
        </body>
      </html>
    </SessionProvider>
  )
}
