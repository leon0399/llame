import {
  clampModelAllowlistToInstanceCeiling,
  snapshotModelAllowlist,
  type RunConfigSnapshot,
} from './effective-config';

const snap = (models: unknown) => ({ effective: { models } });

const fullSnapshot = (models: unknown): RunConfigSnapshot => ({
  effective: { models },
  provenance: {},
  layers: [],
  computedAt: new Date(0).toISOString(),
});

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

describe('clampModelAllowlistToInstanceCeiling (#85 security hardening)', () => {
  it('is a no-op when the operator (instance) set no allowlist', () => {
    const snapshot = fullSnapshot({ allowlist: ['gpt-4o', 'grok-3'] });
    const clamped = clampModelAllowlistToInstanceCeiling(snapshot, {});
    expect(snapshotModelAllowlist(clamped)).toEqual(['gpt-4o', 'grok-3']);
  });

  it('a lower-scope allowlist that WIDENS past the instance ceiling is clamped down to it', () => {
    const instanceConfig = { models: { allowlist: ['gpt-4o'] } };
    // A user-scope config claims a wider set — must never leak past the ceiling.
    const merged = fullSnapshot({ allowlist: ['gpt-4o', 'claude-4-opus'] });
    const clamped = clampModelAllowlistToInstanceCeiling(
      merged,
      instanceConfig,
    );
    expect(snapshotModelAllowlist(clamped)).toEqual(['gpt-4o']);
  });

  it('a lower-scope allowlist that NARROWS the instance ceiling is honored', () => {
    const instanceConfig = {
      models: { allowlist: ['gpt-4o', 'claude-4-opus', 'grok-3'] },
    };
    const merged = fullSnapshot({ allowlist: ['grok-3'] });
    const clamped = clampModelAllowlistToInstanceCeiling(
      merged,
      instanceConfig,
    );
    expect(snapshotModelAllowlist(clamped)).toEqual(['grok-3']);
  });

  it('falls back to the instance ceiling when no lower scope set an allowlist', () => {
    const instanceConfig = { models: { allowlist: ['gpt-4o'] } };
    const merged = fullSnapshot(undefined);
    const clamped = clampModelAllowlistToInstanceCeiling(
      merged,
      instanceConfig,
    );
    expect(snapshotModelAllowlist(clamped)).toEqual(['gpt-4o']);
  });

  it('a fully disjoint lower-scope allowlist falls back to the ceiling, never to "unrestricted"', () => {
    const instanceConfig = { models: { allowlist: ['gpt-4o'] } };
    const merged = fullSnapshot({ allowlist: ['grok-3'] });
    const clamped = clampModelAllowlistToInstanceCeiling(
      merged,
      instanceConfig,
    );
    // An empty array would parse back as "no restriction" via
    // snapshotModelAllowlist — asserting the ceiling itself, not [], is the
    // point of this test.
    expect(snapshotModelAllowlist(clamped)).toEqual(['gpt-4o']);
  });
});
