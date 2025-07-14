"use client";

import { createContext, useContext, useState, ReactNode } from 'react';
import { useTheme } from 'next-themes';

export type Theme = 'light' | 'dark' | 'system' | string;
export type FontSize = 'small' | 'medium' | 'large';
export type FontStyle = 'geist' | 'system' | 'open-dyslexic';
export type MonoFontStyle = 'geist-mono' | 'fira-code' | 'jetbrains-mono' | 'system' | 'open-dyslexic-mono';

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
