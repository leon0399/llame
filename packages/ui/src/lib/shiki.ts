import {
  createBundledHighlighter,
  createSingletonShorthands,
  guessEmbeddedLanguages,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { bundledLanguages } from "shiki/langs";
import { bundledThemes } from "shiki/themes";

/**
 * Shiki's `codeToHtml`/`codeToTokens` shorthands on the JavaScript regex
 * engine. The `shiki` entry's shorthands use the Oniguruma engine, whose WASM
 * binary is ~230 KB gzipped; the transcript's Markdown code blocks
 * (`@streamdown/code`) already highlight with this engine.
 */
export const { codeToHtml, codeToTokens } = createSingletonShorthands(
  createBundledHighlighter({
    langs: bundledLanguages,
    themes: bundledThemes,
    engine: () => createJavaScriptRegexEngine({ forgiving: true }),
  }),
  { guessEmbeddedLanguages },
);
