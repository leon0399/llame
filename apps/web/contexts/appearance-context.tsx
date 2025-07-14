"use client";

import { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { useTheme } from 'next-themes';
import { 
  FontStyle, 
  MonoFontStyle, 
  fontStyleOptions, 
  monoFontStyleOptions,
  FONT_STYLE_COOKIE,
  MONO_FONT_STYLE_COOKIE
} from '@/lib/appearance/font/consts';

// Client-side cookie helper
function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
  return null;
}

function setCookie(name: string, value: string) {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${value}; path=/; max-age=31536000; SameSite=Lax`;
}

export function setFontStyleCookie(fontStyle: FontStyle) {
  document.cookie = `${FONT_STYLE_COOKIE}=${fontStyle}; path=/; max-age=31536000; SameSite=Lax`;
}

export function setMonoFontStyleCookie(monoFontStyle: MonoFontStyle) {
  document.cookie = `${MONO_FONT_STYLE_COOKIE}=${monoFontStyle}; path=/; max-age=31536000; SameSite=Lax`;
}

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
  fontStyle: 'geist',
  setFontStyle: () => { },
  monoFontStyle: 'geist-mono',
  setMonoFontStyle: () => { },
});

export function useAppearance() {
  return useContext(AppearanceContext);
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { theme, setTheme } = useTheme();
  const [fontSize, setFontSize] = useState<FontSize>('medium');
  const [fontStyle, setFontStyle] = useState<FontStyle>('geist');
  const [monoFontStyle, setMonoFontStyle] = useState<MonoFontStyle>('geist-mono');

  // Load from cookies on mount
  useEffect(() => {
    const savedFontSize = getCookie('appearance-font-size') as FontSize;
    const savedFontStyle = getCookie(FONT_STYLE_COOKIE) as FontStyle;
    const savedMonoFontStyle = getCookie(MONO_FONT_STYLE_COOKIE) as MonoFontStyle;
    
    if (savedFontSize) setFontSize(savedFontSize);
    if (savedFontStyle) setFontStyle(savedFontStyle);
    if (savedMonoFontStyle) setMonoFontStyle(savedMonoFontStyle);
  }, []);

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

  const handleSetFontStyle = (style: FontStyle) => {
    setFontStyle(style);
    setFontStyleCookie(style);
  };

  const handleSetMonoFontStyle = (style: MonoFontStyle) => {
    setMonoFontStyle(style);
    setMonoFontStyleCookie(style);
  };

  const handleSetFontSize = (size: FontSize) => {
    setFontSize(size);
    setCookie('appearance-font-size', size);
  };

  return (
    <AppearanceContext.Provider
      value={{
        theme: theme || 'system',
        setTheme,
        fontSize,
        setFontSize: handleSetFontSize,
        fontStyle,
        setFontStyle: handleSetFontStyle,
        monoFontStyle,
        setMonoFontStyle: handleSetMonoFontStyle,
      }}
    >
      {children}
    </AppearanceContext.Provider>
  );
}
