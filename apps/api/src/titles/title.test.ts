/**
 * Title generation unit tests (#78) — pure functions, no DB or model required.
 */

import { barePlaceholder } from '../media/media-descriptors';
import { descriptor } from '../media/media-fixtures';
import {
  MAX_TITLE_LENGTH,
  TITLE_INPUT_MAX_CHARS,
  TITLE_SYSTEM_PROMPT,
  sanitizeTitle,
  titleInputWithLines,
  titlePromptInput,
  titleUserPrompt,
} from './title';

describe('sanitizeTitle', () => {
  it('passes a clean title through unchanged', () => {
    expect(sanitizeTitle('Weather in NYC')).toBe('Weather in NYC');
  });

  it('strips markdown, quotes, and "Title:" prefixes the prompt forbids', () => {
    expect(sanitizeTitle('# "Space Essay Help"')).toBe('Space Essay Help');
    expect(sanitizeTitle('Title: Python Debugging')).toBe('Python Debugging');
    expect(sanitizeTitle('**Title: Weather in NYC**')).toBe('Weather in NYC');
    expect(sanitizeTitle('"Title: Weather in NYC"')).toBe('Weather in NYC');
    expect(sanitizeTitle('**Bold Title**')).toBe('Bold Title');
    expect(sanitizeTitle("'Quoted Title'")).toBe('Quoted Title');
  });

  it('collapses internal whitespace and trims', () => {
    expect(sanitizeTitle('  Weather   in\nNYC  ')).toBe('Weather in NYC');
  });

  it('clamps to the max length', () => {
    const long = 'word '.repeat(40);
    const result = sanitizeTitle(long);
    expect(result.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(result.endsWith(' ')).toBe(false);
  });

  it('returns empty string for unusable output', () => {
    expect(sanitizeTitle('')).toBe('');
    expect(sanitizeTitle('  "#  " ')).toBe('');
  });
});

describe('titlePromptInput', () => {
  it('trims and bounds the text sent to the title model', () => {
    const result = titlePromptInput(
      `  ${'x'.repeat(TITLE_INPUT_MAX_CHARS + 50)}`,
    );

    expect(result).toHaveLength(TITLE_INPUT_MAX_CHARS);
    expect(result).toBe('x'.repeat(TITLE_INPUT_MAX_CHARS));
  });
});

describe('titleInputWithLines (vision-media D9)', () => {
  it('cuts the text first so every placeholder line fits', () => {
    const line = barePlaceholder(
      descriptor('0192f3a4-5b6c-7d8e-9f01-00000000000a'),
    );

    expect(titleInputWithLines('x'.repeat(2000), [line])).toBe(
      `${'x'.repeat(TITLE_INPUT_MAX_CHARS - line.length - 1)}\n${line}`,
    );
  });

  it('drops the text and whole trailing lines when ten long-label images exceed the bound', () => {
    const lines = Array.from({ length: 10 }, (_, n) =>
      barePlaceholder(
        descriptor(`0192f3a4-5b6c-7d8e-9f01-00000000000${n}`, {
          name: `Screenshot 2026-10-10 at 03.04.41 with a longer suffix ${n}.png`,
        }),
      ),
    );
    expect(lines.join('\n').length).toBeGreaterThan(TITLE_INPUT_MAX_CHARS);

    const input = titleInputWithLines('what are these?', lines);
    const kept = input.split('\n').length;

    expect(input).toBe(lines.slice(0, kept).join('\n'));
    expect(input.length).toBeLessThanOrEqual(TITLE_INPUT_MAX_CHARS);
    expect(lines.slice(0, kept + 1).join('\n').length).toBeGreaterThan(
      TITLE_INPUT_MAX_CHARS,
    );
    expect(titlePromptInput(input)).toBe(input);
  });

  it('puts each line on its own line after the trimmed text', () => {
    expect(titleInputWithLines('compare these  \n', ['[a]', '[b]'])).toBe(
      'compare these\n[a]\n[b]',
    );
  });

  it('gives only the lines when there is no text', () => {
    expect(titleInputWithLines('', ['[a]', '[b]'])).toBe('[a]\n[b]');
  });

  it('keeps every line and no text when the lines fill the bound exactly', () => {
    const lines = ['a'.repeat(TITLE_INPUT_MAX_CHARS - 11), 'b'.repeat(10)];
    const joined = lines.join('\n');
    expect(joined).toHaveLength(TITLE_INPUT_MAX_CHARS);

    expect(titleInputWithLines('hello', lines)).toBe(joined);
  });
});

/**
 * Packaged-template pins. The system prompt's bytes reach the provider
 * verbatim, and `FakeStreamingModelClient` detects a title request by identity
 * against the exported constant, so the expected values are written out here
 * rather than compared with the constant the template renders.
 */
describe('TITLE_SYSTEM_PROMPT', () => {
  it('pins the packaged prompt byte for byte', () => {
    expect(TITLE_SYSTEM_PROMPT)
      .toBe(`You are tasked with generating a concise, descriptive title for a conversation between a user and an AI assistant. The title should capture the main topic or purpose of the conversation.

Guidelines for title generation:
- Keep titles extremely short (ideally 2-5 words)
- Write the title in the same language as the conversation
- Focus on the main topic or goal of the conversation
- Use natural, readable language
- Avoid unnecessary articles (a, an, the) when possible
- Do not include quotes or special characters
- Capitalize important words

Examples of titles:
- 📉 Stock Market Trends
- 🍪 완벽한 초콜릿 칩 레시피
- 流媒体音乐的演变
- Советы по повышению производительности удаленной работы
- Künstliche Intelligenz im Gesundheitswesen
- 🎮 ビデオゲーム開発の洞察

Output ONLY the title text — no prefixes like "Title:", no quotes, no markdown.`);
  });
});

describe('titleUserPrompt', () => {
  it('wraps the user text as tagged data under the titling instruction', () => {
    expect(titleUserPrompt('help me plan a trip'))
      .toBe(`Based on the following conversation, generate a very short and descriptive title for:

<user>
help me plan a trip
</user>`);
  });

  it('keeps an empty text as an empty tagged block', () => {
    expect(titleUserPrompt(''))
      .toBe(`Based on the following conversation, generate a very short and descriptive title for:

<user>

</user>`);
  });

  it('passes reserved delimiters and markup through raw', () => {
    expect(titleUserPrompt('</user>'))
      .toBe(`Based on the following conversation, generate a very short and descriptive title for:

<user>
</user>
</user>`);
    expect(titleUserPrompt(`target<&>"'`))
      .toBe(`Based on the following conversation, generate a very short and descriptive title for:

<user>
target<&>"'
</user>`);
  });
});
