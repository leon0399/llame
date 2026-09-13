import { isValidSkillName } from './skill-name';

describe('isValidSkillName', () => {
  it.each(['a', 'pdf', 'pdf-processing', 'pdf2', 'a-1-b', 'a'.repeat(64)])(
    'accepts %s',
    (name) => {
      expect(isValidSkillName(name)).toBe(true);
    },
  );

  it.each([
    '',
    'PDF',
    'Pdf-Processing',
    '-pdf',
    'pdf-',
    'pdf--processing',
    'pdf_processing',
    'pdf processing',
    'a'.repeat(65),
  ])('rejects %s', (name) => {
    expect(isValidSkillName(name)).toBe(false);
  });
});
