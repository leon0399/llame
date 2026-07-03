import { snapshotModelAllowlist } from './effective-config';

const snap = (models: unknown) => ({ effective: { models } });

describe('snapshotModelAllowlist (#85)', () => {
  it('returns a valid non-empty string array', () => {
    expect(
      snapshotModelAllowlist(snap({ allowlist: ['gpt-4o', 'grok-3'] })),
    ).toEqual(['gpt-4o', 'grok-3']);
  });

  it('drops non-string / empty members', () => {
    expect(
      snapshotModelAllowlist(snap({ allowlist: ['gpt-4o', '', 3, null] })),
    ).toEqual(['gpt-4o']);
  });

  it('undefined (no restriction) for absent / non-array / empty', () => {
    expect(snapshotModelAllowlist(snap(undefined))).toBeUndefined();
    expect(snapshotModelAllowlist(snap({ allowlist: [] }))).toBeUndefined();
    expect(
      snapshotModelAllowlist(snap({ allowlist: 'gpt-4o' })),
    ).toBeUndefined();
    expect(snapshotModelAllowlist(snap({ allowlist: [''] }))).toBeUndefined();
    expect(snapshotModelAllowlist({})).toBeUndefined();
  });
});
