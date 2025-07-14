export const fontStyleOptions = [
  { value: 'geist', label: 'Geist', cssVar: 'var(--font-geist)' },
  { value: 'open-sans', label: 'Open Sans', cssVar: 'var(--font-open-sans)' },
  { value: 'roboto', label: 'Roboto', cssVar: 'var(--font-roboto)' },
  { value: 'roboto-condensed', label: 'Roboto Condensed', cssVar: 'var(--font-roboto-condensed)' },
  { value: 'system', label: 'System', cssVar: 'ui-sans-serif, system-ui, sans-serif' },
] as const;

export const monoFontStyleOptions = [
  { value: 'geist-mono', label: 'Geist Mono', cssVar: 'var(--font-geist-mono)' },
  { value: 'fira-code', label: 'Fira Code', cssVar: 'var(--font-fira-code)' },
  { value: 'jetbrains-mono', label: 'JetBrains Mono', cssVar: 'var(--font-jetbrains-mono)' },
  { value: 'roboto-mono', label: 'Roboto Mono', cssVar: 'var(--font-roboto-mono)' },
  { value: 'system', label: 'System Mono', cssVar: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace' },
] as const;

export type FontStyle = typeof fontStyleOptions[number]['value'];
export type MonoFontStyle = typeof monoFontStyleOptions[number]['value'];

export const DEFAULT_FONT_STYLE: FontStyle = 'system' as const;
export const DEFAULT_MONO_FONT_STYLE: MonoFontStyle = 'jetbrains-mono' as const;

export const FONT_STYLE_COOKIE = 'font-style' as const;
export const MONO_FONT_STYLE_COOKIE = 'mono-font-style' as const;