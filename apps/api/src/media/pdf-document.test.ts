import { readFileSync } from 'node:fs';
import path from 'node:path';

import { inspectPdfDocument } from './pdf-document';

function fixture(name: string) {
  return readFileSync(path.join(__dirname, 'testing', 'pdf', name));
}

describe('inspectPdfDocument', () => {
  it.each([
    ['one-page.pdf', 1],
    ['fifteen-pages.pdf', 15],
  ])(
    'reports the actual pages of %s without encryption',
    async (name, pages) => {
      expect(await inspectPdfDocument(fixture(name))).toEqual({
        pages,
        encrypted: false,
      });
    },
  );

  it('detects an encrypted PDF that opens without a password', async () => {
    expect(await inspectPdfDocument(fixture('owner-password.pdf'))).toEqual({
      pages: 1,
      encrypted: true,
    });
  });

  it('rejects a password-required PDF', async () => {
    await expect(
      inspectPdfDocument(fixture('user-password.pdf')),
    ).rejects.toMatchObject({ name: 'PasswordException' });
  });
});
