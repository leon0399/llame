import { BadRequestException } from '@nestjs/common';

import { RejectNulCharactersPipe } from './reject-nul-characters.pipe';

describe('RejectNulCharactersPipe', () => {
  const pipe = new RejectNulCharactersPipe();

  it.each([
    ['a query string', 'a\u0000b'],
    ['a nested body value', { message: { parts: [{ text: 'x\u0000' }] } }],
    ['a body key', { ['na\u0000me']: 'x' }],
    ['an array element', ['ok', '\u0000']],
  ])('rejects %s holding NUL with a 400', (_, value) => {
    expect(() => pipe.transform(value)).toThrow(BadRequestException);
  });

  it('passes other values through unchanged', () => {
    const value = { name: 'tab\there', count: 3, tags: ['a', null], ok: true };

    expect(pipe.transform(value)).toBe(value);
  });
});
