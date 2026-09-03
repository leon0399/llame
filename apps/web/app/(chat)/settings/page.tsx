"use client";

import type { ComponentProps, ReactNode } from "react";

import {
  useAppearance,
  fontStyleOptions,
  monoFontStyleOptions,
  type Theme,
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
import {
  InterfaceFontSwitcher,
  CodeFontSwitcher,
} from "@/components/font-switcher";
import { MemorySection } from "./components/memory-section";
import { PersonalizationSection } from "./components/personalization-section";

function themeIcon(theme: Theme) {
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
}

function themeLabel(theme: Theme) {
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
}

function ThemeDropdown({
  theme,
  setTheme,
}: {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        {themeIcon(theme)}
        {themeLabel(theme)}
        <ChevronDownIcon className="h-4 w-4 ml-2 opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
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
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-1">
        <p className="text-sm font-medium leading-none">{label}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

function FontSettingRow({
  label,
  description,
  Switcher,
  options,
  currentValue,
  onValueChange,
}: {
  label: string;
  description: string;
  Switcher: typeof InterfaceFontSwitcher;
} & ComponentProps<typeof InterfaceFontSwitcher>) {
  return (
    <SettingRow label={label} description={description}>
      <Switcher
        options={options}
        currentValue={currentValue}
        onValueChange={onValueChange}
      />
    </SettingRow>
  );
}

// Static (no props/state), so it's hoisted rather than rebuilt every render.
const appearanceCardHeader = (
  <CardHeader>
    <CardTitle>Appearance</CardTitle>
    <CardDescription>
      Choose your preferred theme and font styles.
    </CardDescription>
  </CardHeader>
);

function AppearanceSection() {
  const {
    theme,
    setTheme,
    fontStyle,
    setFontStyle,
    monoFontStyle,
    setMonoFontStyle,
  } = useAppearance();
  return (
    <Card className="lg:max-w-2xl">
      {appearanceCardHeader}
      <CardContent className="space-y-6">
        <SettingRow label="Theme" description="Select the theme for the app.">
          <ThemeDropdown theme={theme} setTheme={setTheme} />
        </SettingRow>
        <FontSettingRow
          label="Interface Font"
          description="Select the font for the interface."
          Switcher={InterfaceFontSwitcher}
          options={fontStyleOptions}
          currentValue={fontStyle}
          onValueChange={setFontStyle}
        />
        <FontSettingRow
          label="Code Font"
          description="Select the font for code blocks."
          Switcher={CodeFontSwitcher}
          options={monoFontStyleOptions}
          currentValue={monoFontStyle}
          onValueChange={setMonoFontStyle}
        />
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
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
      <AppearanceSection />
      <PersonalizationSection />
      <MemorySection />
    </div>
  );
}
