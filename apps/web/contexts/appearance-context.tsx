"use client";

import { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { useTheme } from 'next-themes';
import { 
  type FontStyle, 
  type MonoFontStyle, 
  fontStyleOptions, 
  monoFontStyleOptions,
  FONT_STYLE_COOKIE,
  MONO_FONT_STYLE_COOKIE,
  DEFAULT_FONT_STYLE,
  DEFAULT_MONO_FONT_STYLE
} from '@/lib/appearance/font/consts';
import useCookie from '@/hooks/use-cookie';

export type Theme = 'light' | 'dark' | 'system' | string;
export type FontSize = 'small' | 'medium' | 'large';

// Re-export types and options for convenience
export type { FontStyle, MonoFontStyle } from '@/lib/appearance/font/consts';
export { fontStyleOptions, monoFontStyleOptions } from '@/lib/appearance/font/consts';

export interface AppearanceContextProps {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  fontSize: FontSize;
  setFontSize: (size: FontSize) => void;
  fontStyle: FontStyle;
  setFontStyle: (style: FontStyle) => void;
  monoFontStyle: MonoFontStyle;
  setMonoFontStyle: (style: MonoFontStyle) => void;
}

const AppearanceContext = createContext<AppearanceContextProps>({
  theme: 'system',
  setTheme: () => { },
  fontSize: 'medium',
  setFontSize: () => { },
  fontStyle: 'system',
  setFontStyle: () => { },
  monoFontStyle: 'jetbrains-mono',
  setMonoFontStyle: () => { },
});

export function useAppearance() {
  return useContext(AppearanceContext);
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { theme, setTheme } = useTheme();
  const [fontSize, setFontSize] = useState<FontSize>('medium');
  const [fontStyle, setFontStyle] = useCookie<FontStyle>(FONT_STYLE_COOKIE, DEFAULT_FONT_STYLE);
  const [monoFontStyle, setMonoFontStyle] = useCookie<MonoFontStyle>(MONO_FONT_STYLE_COOKIE, DEFAULT_MONO_FONT_STYLE);

  // Apply font changes to Tailwind CSS variables
  useEffect(() => {
    const fontOption = fontStyleOptions.find(f => f.value === fontStyle);
    if (fontOption) {
      document.documentElement.style.setProperty('--font-sans', fontOption.cssVar);
    }
  }, [fontStyle]);

  useEffect(() => {
    const monoFontOption = monoFontStyleOptions.find(f => f.value === monoFontStyle);
    if (monoFontOption) {
      document.documentElement.style.setProperty('--font-mono', monoFontOption.cssVar);
    }
  }, [monoFontStyle]);

  return (
    <AppearanceContext.Provider
      value={{
        theme: theme || 'system',
        setTheme,
        fontSize,
        setFontSize,
        fontStyle,
        setFontStyle,
        monoFontStyle,
        setMonoFontStyle,
      }}
    >
      {children}
    </AppearanceContext.Provider>
  );
}
