"use client";

import {
  useAppearance,
  fontStyleOptions,
  monoFontStyleOptions,
} from "@/contexts/appearance-context";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  MonitorIcon,
  MoonIcon,
  SunIcon,
  PaletteIcon,
  ChevronDownIcon,
} from "lucide-react";
import { useCallback, useMemo } from "react";
import {
  InterfaceFontSwitcher,
  CodeFontSwitcher,
} from "@/components/font-switcher";
import { PersonalizationSection } from "./components/personalization-section";

export default function SettingsPage() {
  const {
    theme,
    setTheme,
    fontStyle,
    setFontStyle,
    monoFontStyle,
    setMonoFontStyle,
  } = useAppearance();

  const CurrentThemeIcon = useCallback(() => {
    switch (theme) {
      case "light":
        return <SunIcon className="h-4 w-4 mr-2" />;
      case "dark":
        return <MoonIcon className="h-4 w-4 mr-2" />;
      case "system":
        return <MonitorIcon className="h-4 w-4 mr-2" />;
      default:
        return <PaletteIcon className="h-4 w-4 mr-2" />;
    }
  }, [theme]);

  const currentThemeLabel = useMemo(() => {
    switch (theme) {
      case "light":
        return "Light";
      case "dark":
        return "Dark";
      case "system":
        return "System";
      default:
        return "Custom";
    }
  }, [theme]);

  return (
    // flex-1 + min-h-0, not h-full: this sits BELOW ChatHeader inside
    // SidebarInset's flex column, so h-full asks for the inset's whole height
    // and overflows by exactly the header — which the inset then clips. Taking
    // the remaining space instead is what lets the scroll region below work.
    <div className="flex min-h-0 w-full flex-1 flex-col justify-start overflow-hidden px-5 pt-12">
      <div className="mb-6 shrink-0 space-y-0.5">
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">
          Manage your account settings and set e-mail preferences.
        </p>
      </div>
      {/* min-h-0 is load-bearing: a flex item defaults to min-height:auto, so
          without it this refuses to shrink below its content, never scrolls,
          and the parent's overflow-hidden clips the cards instead. flex-1
          gives it the leftover height to scroll within. */}
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pb-12">
        <Card className="lg:max-w-2xl">
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>
              Choose your preferred theme and font styles.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium leading-none">Theme</p>
                <p className="text-sm text-muted-foreground">
                  Select the theme for the app.
                </p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="outline" size="sm" />}
                >
                  <CurrentThemeIcon />
                  {currentThemeLabel}
                  <ChevronDownIcon className="h-4 w-4 ml-2 opacity-50" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuRadioGroup
                    value={theme}
                    onValueChange={(value) => setTheme(value)}
                  >
                    <DropdownMenuRadioItem value="light">
                      <SunIcon className="h-4 w-4 mr-2" />
                      Light
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="dark">
                      <MoonIcon className="h-4 w-4 mr-2" />
                      Dark
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="system">
                      <MonitorIcon className="h-4 w-4 mr-2" />
                      System
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium leading-none">
                  Interface Font
                </p>
                <p className="text-sm text-muted-foreground">
                  Select the font for the interface.
                </p>
              </div>
              <InterfaceFontSwitcher
                options={fontStyleOptions}
                currentValue={fontStyle}
                onValueChange={setFontStyle}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium leading-none">Code Font</p>
                <p className="text-sm text-muted-foreground">
                  Select the font for code blocks.
                </p>
              </div>
              <CodeFontSwitcher
                options={monoFontStyleOptions}
                currentValue={monoFontStyle}
                onValueChange={setMonoFontStyle}
              />
            </div>
          </CardContent>
        </Card>
        <PersonalizationSection />
      </div>
    </div>
  );
}
