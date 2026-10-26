import { BadRequestException } from '@nestjs/common';

import { RequireObjectBodyPipe } from './require-object-body.pipe';

class UpdateThingDto {
  name?: string;
}

describe('RequireObjectBodyPipe', () => {
  const pipe = new RequireObjectBodyPipe();
  const body = { type: 'body', metatype: UpdateThingDto } as const;

  it.each([
    ['an array', []],
    ['a string', 'name'],
    ['null', null],
  ])('rejects %s where a DTO body is declared', (_, value) => {
    expect(() => pipe.transform(value, body)).toThrow(BadRequestException);
  });

  it('passes an object or missing body, and values that are not DTO bodies', () => {
    expect(pipe.transform({}, body)).toEqual({});
    expect(pipe.transform(undefined, body)).toBeUndefined();
    expect(pipe.transform([1], { type: 'body', metatype: Array })).toEqual([1]);
    expect(
      pipe.transform('x', { type: 'query', metatype: UpdateThingDto }),
    ).toBe('x');
  });
});
