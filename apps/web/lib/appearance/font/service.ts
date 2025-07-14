"use server";

import { cookies } from 'next/headers';
import { 
  type FontStyle, 
  type MonoFontStyle, 
  fontStyleOptions, 
  monoFontStyleOptions, 
  FONT_STYLE_COOKIE, 
  MONO_FONT_STYLE_COOKIE, 
  DEFAULT_FONT_STYLE,
  DEFAULT_MONO_FONT_STYLE
} from './consts';

export async function getFontStyleFromCookies(): Promise<FontStyle> {
  const cookieStore = await cookies();
  const fontStyle = cookieStore.get(FONT_STYLE_COOKIE)?.value as FontStyle;
  
  // Validate that the font style is valid
  if (fontStyle && fontStyleOptions.some(option => option.value === fontStyle)) {
    return fontStyle;
  }
  
  return DEFAULT_FONT_STYLE; // Default
}

export async function getMonoFontStyleFromCookies(): Promise<MonoFontStyle> {
  const cookieStore = await cookies();
  const monoFontStyle = cookieStore.get(MONO_FONT_STYLE_COOKIE)?.value as MonoFontStyle;
  
  // Validate that the mono font style is valid
  if (monoFontStyle && monoFontStyleOptions.some(option => option.value === monoFontStyle)) {
    return monoFontStyle;
  }

  return DEFAULT_MONO_FONT_STYLE; // Default
}

export async function getFontCssVariables() {
  const fontStyle = await getFontStyleFromCookies();
  const monoFontStyle = await getMonoFontStyleFromCookies();

  const fontOption = fontStyleOptions.find(f => f.value === fontStyle);
  const monoFontOption = monoFontStyleOptions.find(f => f.value === monoFontStyle);

  return {
    '--font-sans': fontOption?.cssVar || 'var(--font-geist)',
    '--font-mono': monoFontOption?.cssVar || 'var(--font-geist-mono)',
  };
}

