"use client";

import { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { useTheme } from 'next-themes';

export type Theme = 'light' | 'dark' | 'system' | string;
export type FontSize = 'small' | 'medium' | 'large';
export type FontStyle = 'geist' | 'roboto' | 'system';
export type MonoFontStyle = 'geist-mono' | 'fira-code' | 'jetbrains-mono' | 'system';

export const fontStyleOptions = [
  { value: 'geist', label: 'Geist', cssVar: 'var(--font-geist)' },
  { value: 'open-sans', label: 'Open Sans', cssVar: 'var(--font-open-sans)' },
  { value: 'roboto', label: 'Roboto', cssVar: 'var(--font-roboto)' },
  { value: 'system', label: 'System', cssVar: 'ui-sans-serif, system-ui, sans-serif' },
] as const;

export const monoFontStyleOptions = [
  { value: 'geist-mono', label: 'Geist Mono', cssVar: 'var(--font-geist-mono)' },
  { value: 'fira-code', label: 'Fira Code', cssVar: 'var(--font-fira-code)' },
  { value: 'jetbrains-mono', label: 'JetBrains Mono', cssVar: 'var(--font-jetbrains-mono)' },
  { value: 'system', label: 'System Mono', cssVar: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace' },
] as const;

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

  // Load from localStorage on mount
  useEffect(() => {
    const savedFontSize = localStorage.getItem('appearance-font-size') as FontSize;
    const savedFontStyle = localStorage.getItem('appearance-font-style') as FontStyle;
    const savedMonoFontStyle = localStorage.getItem('appearance-mono-font-style') as MonoFontStyle;
    
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
    localStorage.setItem('appearance-font-style', style);
  };

  const handleSetMonoFontStyle = (style: MonoFontStyle) => {
    setMonoFontStyle(style);
    localStorage.setItem('appearance-mono-font-style', style);
  };

  const handleSetFontSize = (size: FontSize) => {
    setFontSize(size);
    localStorage.setItem('appearance-font-size', size);
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
