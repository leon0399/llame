import { neutralizeFileElementBody } from './instructions-item';

describe('neutralizeFileElementBody', () => {
  it.each([
    ['a tag cut off at the end of the body', 'text <file', 'text &lt;file'],
    ['a tag with space before the bracket', '<file >', '&lt;file >'],
    [
      'an attribute after several separators',
      '<file   path="x">',
      '&lt;file   path="x">',
    ],
    [
      'an attribute after a slash and spaces',
      '<file / path="x">',
      '&lt;file / path="x">',
    ],
    [
      'an attribute followed by spaces before its equals sign',
      '<file path ="x">',
      '&lt;file path ="x">',
    ],
  ])('escapes %s', (_label, body, expected) => {
    expect(neutralizeFileElementBody(body)).toBe(expected);
  });

  it.each(['<profile>', '<myfile path="x">', '<file foo>', '<files>'])(
    'leaves %s alone',
    (body) => {
      expect(neutralizeFileElementBody(body)).toBe(body);
    },
  );
});
