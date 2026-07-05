import { inspect } from 'node:util';

import {
  CredentialCryptoError,
  decryptCredential,
  encryptCredential,
  parseMasterKeyRing,
  SecretString,
} from './credential-crypto';

const KEY_V1 = Buffer.alloc(32, 1).toString('base64');
const KEY_V2 = Buffer.alloc(32, 2).toString('base64');

describe('SecretString', () => {
  const secret = new SecretString('sk-super-secret');

  it('redacts in every serialization path', () => {
    expect(String(secret)).toBe('[REDACTED]');
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- the accidental-interpolation path is exactly what this asserts
    expect(`${secret}`).toBe('[REDACTED]');
    expect(JSON.stringify({ key: secret })).toBe('{"key":"[REDACTED]"}');
    expect(inspect(secret)).toBe('[REDACTED]');
    expect(inspect({ nested: secret })).toContain('[REDACTED]');
  });

  it('reveals only explicitly', () => {
    expect(secret.reveal()).toBe('sk-super-secret');
  });

  it('compares in constant time without exposing values', () => {
    expect(secret.equals(new SecretString('sk-super-secret'))).toBe(true);
    expect(secret.equals(new SecretString('sk-other'))).toBe(false);
    expect(secret.equals(new SecretString('short'))).toBe(false);
  });
});

describe('parseMasterKeyRing', () => {
  it('returns null when unset or blank (vault disabled, boot proceeds)', () => {
    expect(parseMasterKeyRing(undefined)).toBeNull();
    expect(parseMasterKeyRing('')).toBeNull();
    expect(parseMasterKeyRing('   ')).toBeNull();
  });

  it('parses a multi-version ring and seals under the highest', () => {
    const ring = parseMasterKeyRing(`1:${KEY_V1},2:${KEY_V2}`)!;
    expect(ring.currentVersion).toBe(2);
    expect([...ring.keys.keys()].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it.each([
    ['not-a-version', `x:${KEY_V1}`],
    ['zero version', `0:${KEY_V1}`],
    ['missing key', '1:'],
    ['short key', `1:${Buffer.alloc(8, 1).toString('base64')}`],
    ['duplicate version', `1:${KEY_V1},1:${KEY_V2}`],
  ])('rejects malformed ring: %s', (_label, raw) => {
    expect(() => parseMasterKeyRing(raw)).toThrow(CredentialCryptoError);
  });
});

describe('encrypt/decrypt roundtrip', () => {
  const ring = parseMasterKeyRing(`1:${KEY_V1}`)!;
  const accountId = 'a0000000-0000-0000-0000-000000000001';

  it('roundtrips and stamps the sealing key version', () => {
    const sealed = encryptCredential({
      ring,
      providerAccountId: accountId,
      secretType: 'api_key',
      secret: new SecretString('sk-roundtrip'),
    });
    expect(sealed.keyVersion).toBe(1);
    expect(sealed.encryptedPayload).not.toContain('sk-roundtrip');

    const opened = decryptCredential({
      ring,
      providerAccountId: accountId,
      secretType: 'api_key',
      encryptedPayload: sealed.encryptedPayload,
      keyVersion: sealed.keyVersion,
    });
    expect(opened.reveal()).toBe('sk-roundtrip');
  });

  it('rotation: v1 payloads stay readable, new seals use v2', () => {
    const sealedV1 = encryptCredential({
      ring,
      providerAccountId: accountId,
      secretType: 'api_key',
      secret: new SecretString('sk-old'),
    });
    const rotated = parseMasterKeyRing(`1:${KEY_V1},2:${KEY_V2}`)!;
    expect(
      decryptCredential({
        ring: rotated,
        providerAccountId: accountId,
        secretType: 'api_key',
        encryptedPayload: sealedV1.encryptedPayload,
        keyVersion: sealedV1.keyVersion,
      }).reveal(),
    ).toBe('sk-old');
    expect(
      encryptCredential({
        ring: rotated,
        providerAccountId: accountId,
        secretType: 'api_key',
        secret: new SecretString('sk-new'),
      }).keyVersion,
    ).toBe(2);
  });

  it('fails closed on a removed key version', () => {
    const sealed = encryptCredential({
      ring,
      providerAccountId: accountId,
      secretType: 'api_key',
      secret: new SecretString('sk-x'),
    });
    const withoutV1 = parseMasterKeyRing(`2:${KEY_V2}`)!;
    expect(() =>
      decryptCredential({
        ring: withoutV1,
        providerAccountId: accountId,
        secretType: 'api_key',
        encryptedPayload: sealed.encryptedPayload,
        keyVersion: sealed.keyVersion,
      }),
    ).toThrow(/No master key for version 1/);
  });

  it('detects tampered ciphertext', () => {
    const sealed = encryptCredential({
      ring,
      providerAccountId: accountId,
      secretType: 'api_key',
      secret: new SecretString('sk-tamper'),
    });
    const [v, iv, tag, ct] = sealed.encryptedPayload.split('.');
    const flipped = Buffer.from(ct, 'base64');
    flipped[0] ^= 0xff;
    const tampered = [v, iv, tag, flipped.toString('base64')].join('.');
    expect(() =>
      decryptCredential({
        ring,
        providerAccountId: accountId,
        secretType: 'api_key',
        encryptedPayload: tampered,
        keyVersion: 1,
      }),
    ).toThrow(/decryption failed/);
  });

  it('rejects a ciphertext replayed onto a different account (AAD)', () => {
    const sealed = encryptCredential({
      ring,
      providerAccountId: accountId,
      secretType: 'api_key',
      secret: new SecretString('sk-replay'),
    });
    expect(() =>
      decryptCredential({
        ring,
        providerAccountId: 'b0000000-0000-0000-0000-000000000002',
        secretType: 'api_key',
        encryptedPayload: sealed.encryptedPayload,
        keyVersion: 1,
      }),
    ).toThrow(/decryption failed/);
  });
});
