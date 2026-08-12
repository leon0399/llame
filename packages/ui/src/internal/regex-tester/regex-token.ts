/**
 * The narrow token protocol shared by the Markdown, highlighted-code, and
 * interaction adapters. It contains no renderer, DOM, or regex-evaluation
 * dependencies.
 */
export const REGEX_TOKEN_TAG = "regex-token";
export const REGEX_TOKEN_ATTRIBUTE = "data-regex-token";

export const isRegexTokenTag = (tagName: string): boolean =>
  tagName === REGEX_TOKEN_TAG;

export const isRegexTokenAttribute = (attributeName: string): boolean =>
  attributeName === REGEX_TOKEN_ATTRIBUTE;

export const isRegexTokenValue = (
  value: string | null | undefined,
): value is string => typeof value === "string" && value.length > 0;
