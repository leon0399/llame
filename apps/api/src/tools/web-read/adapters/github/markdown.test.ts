import { describe, expect, it } from 'vitest';

import { fencedBlock } from './markdown';

describe('fencedBlock', () => {
  it('fences ordinary content with three backticks and the info string', () => {
    expect(fencedBlock('const a = 1;\nconst b = 2;', 'ts')).toBe(
      '```ts\nconst a = 1;\nconst b = 2;\n```',
    );
    expect(fencedBlock('plain', null)).toBe('```\nplain\n```');
  });

  it('keeps three backticks when the content has only shorter runs', () => {
    expect(fencedBlock('a `b` and ``c``', null)).toBe(
      '```\na `b` and ``c``\n```',
    );
  });

  it('outgrows the longest backtick run so the content cannot close the fence', () => {
    expect(fencedBlock('```sh\nls\n```', 'md')).toBe(
      '````md\n```sh\nls\n```\n````',
    );
    expect(fencedBlock('a ````` b\n``` c', null)).toBe(
      '``````\na ````` b\n``` c\n``````',
    );
  });
});
