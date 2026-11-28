"use client";

import type { ComponentProps } from "react";

import { SettingField } from "@/components/setting-field";
import {
  useAppearance,
  fontStyleOptions,
  monoFontStyleOptions,
  type Theme,
} from "@/contexts/appearance-context";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
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
        <ChevronDownIcon className="ml-2 h-4 w-4 opacity-50" />
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
    <SettingField
      label={label}
      description={description}
      action={
        <Switcher
          options={options}
          currentValue={currentValue}
          onValueChange={onValueChange}
        />
      }
    />
  );
}

export function AppearanceSection() {
  const {
    theme,
    setTheme,
    fontStyle,
    setFontStyle,
    monoFontStyle,
    setMonoFontStyle,
  } = useAppearance();

  return (
    <Card>
      <CardContent>
        <div className="space-y-6">
          <SettingField
            label="Theme"
            description="Light, dark, or follow the system."
            action={<ThemeDropdown theme={theme} setTheme={setTheme} />}
          />
          <FontSettingRow
            label="Interface font"
            description="The face for text and controls."
            Switcher={InterfaceFontSwitcher}
            options={fontStyleOptions}
            currentValue={fontStyle}
            onValueChange={setFontStyle}
          />
          <FontSettingRow
            label="Code font"
            description="The face for code, paths and commands."
            Switcher={CodeFontSwitcher}
            options={monoFontStyleOptions}
            currentValue={monoFontStyle}
            onValueChange={setMonoFontStyle}
          />
        </div>
      </CardContent>
    </Card>
  );
}
