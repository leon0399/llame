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
    // ONE scroll container: `h-full` + `overflow-y-auto` on the same element.
    // The overflow is what resolves this flex child's `min-height: auto` to 0,
    // so it shrinks past ChatHeader instead of overflowing SidebarInset.
    //
    // Deliberately BLOCK flow (`space-y-6`), not a flex column. `Card` sets
    // `overflow-hidden`, which zeroes its own `min-height: auto` — as a flex
    // item it then shrinks to fit this bounded height instead of overflowing
    // it, and clips its content rather than scrolling the page. Block children
    // cannot shrink, so they stack at natural height and the overflow lands
    // here, where it belongs.
    //
    // The padding is not decorative either. A `ring` paints OUTSIDE the border
    // box, so a card flush against this element's clip edge loses its ring top
    // and bottom. `py-12` is the room it paints into.
    <div className="h-full w-full space-y-6 overflow-y-auto px-5 py-12">
      <div className="space-y-0.5">
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">
          Manage your account settings and set e-mail preferences.
        </p>
      </div>
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
              <p className="text-sm font-medium leading-none">Interface Font</p>
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
  );
}
