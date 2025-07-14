"use client";

import { useAppearance, fontStyleOptions, monoFontStyleOptions } from "@/contexts/appearance-context";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@workspace/ui/components/dropdown-menu";
import { MonitorIcon, MoonIcon, SunIcon, PaletteIcon } from "lucide-react";
import { useCallback, useMemo } from "react";
import { InterfaceFontSwitcher, CodeFontSwitcher } from "@/components/font-switcher";

export default function SettingsPage() {
  const { theme, setTheme, fontStyle, setFontStyle, monoFontStyle, setMonoFontStyle } = useAppearance();

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
    <div className="flex h-full w-full flex-col justify-start overflow-hidden px-5 py-12">
      <div className="mb-6 space-y-0.5">
        <h2 className="text-2xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">Manage your account settings and set e-mail preferences.</p>
      </div>
      <div className="flex flex-col">
        <Card className="lg:max-w-2xl">
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>Choose your preferred theme and font styles.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium leading-none">Theme</p>
                <p className="text-sm text-muted-foreground">Select the theme for the app.</p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <CurrentThemeIcon />
                    {currentThemeLabel}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value)}>
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
                <p className="text-sm text-muted-foreground">Select the font for the interface.</p>
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
                <p className="text-sm text-muted-foreground">Select the font for code blocks.</p>
              </div>
              <CodeFontSwitcher 
                options={monoFontStyleOptions}
                currentValue={monoFontStyle}
                onValueChange={setMonoFontStyle}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}