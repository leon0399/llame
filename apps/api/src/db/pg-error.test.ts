import { pgErrorCode } from './pg-error';

describe('pgErrorCode', () => {
  it('reads a direct .code', () => {
    expect(pgErrorCode({ code: '23505' })).toBe('23505');
  });

  it('reads .cause.code when .code is absent', () => {
    expect(pgErrorCode({ cause: { code: '40001' } })).toBe('40001');
  });

  it('prefers a direct .code over a nested .cause.code', () => {
    expect(pgErrorCode({ code: '23505', cause: { code: '40001' } })).toBe(
      '23505',
    );
  });

  it('returns undefined for a non-record error', () => {
    expect(pgErrorCode('not an object')).toBeUndefined();
    expect(pgErrorCode(null)).toBeUndefined();
    expect(pgErrorCode(undefined)).toBeUndefined();
  });

  it('returns undefined when neither .code nor .cause.code is a string', () => {
    expect(pgErrorCode(new Error('plain'))).toBeUndefined();
    expect(pgErrorCode({ code: 500 })).toBeUndefined();
    expect(pgErrorCode({ cause: { code: 500 } })).toBeUndefined();
    expect(pgErrorCode({ cause: 'not a record' })).toBeUndefined();
  });
});
