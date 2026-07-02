/**
 * Credential envelope encryption (#18, SPEC §14.2).
 *
 * AES-256-GCM under a versioned master key ring from the environment:
 *   CREDENTIAL_MASTER_KEYS="1:<base64 32B>[,2:<base64 32B>,…]"
 * New secrets seal under the HIGHEST version; decryption picks the key by
 * the credential row's key_version — so rotation is "append a new version,
 * re-encrypt lazily", never a flag-day. (Reference research: none of
 * open-webui / opencode / claude-code version their ciphertexts — rotating
 * their secret silently bricks existing rows. We deliberately do.)
 *
 * The GCM AAD binds the ciphertext to (provider_account_id, secret_type):
 * a ciphertext copied onto a different account row fails authentication —
 * no cross-account replay, even by someone with raw DB write access.
 *
 * Envelope wire format (single TEXT column): `v1.<iv b64>.<tag b64>.<ct b64>`.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { inspect } from 'node:util';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const FORMAT = 'v1';

/**
 * A secret that refuses to serialize (opencode's Redacted<T> idea): logging,
 * JSON.stringify, template literals and util.inspect all yield [REDACTED].
 * Only an explicit .reveal() at the provider-client boundary exposes it.
 */
export class SecretString {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  equals(other: SecretString): boolean {
    const a = Buffer.from(this.#value);
    const b = Buffer.from(other.#value);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  toString(): string {
    return '[REDACTED]';
  }

  toJSON(): string {
    return '[REDACTED]';
  }

  [inspect.custom](): string {
    return '[REDACTED]';
  }
}

export type MasterKeyRing = {
  /** Highest version — new secrets seal under this. */
  currentVersion: number;
  keys: Map<number, Buffer>;
};

export class CredentialCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialCryptoError';
  }
}

/**
 * Parse the CREDENTIAL_MASTER_KEYS env value. Returns null when unset/empty —
 * the instance boots fine without a vault (BYOK endpoints then fail closed
 * with a clear error; SPEC §14.3 boot-with-no-provider holds either way).
 */
export function parseMasterKeyRing(
  raw: string | undefined,
): MasterKeyRing | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }
  const keys = new Map<number, Buffer>();
  for (const entry of trimmed.split(',')) {
    const [versionPart, keyPart, ...rest] = entry.split(':');
    const version = Number(versionPart);
    if (
      rest.length > 0 ||
      !Number.isInteger(version) ||
      version <= 0 ||
      !keyPart
    ) {
      throw new CredentialCryptoError(
        `CREDENTIAL_MASTER_KEYS entry is not "<version>:<base64 key>" (entry ${JSON.stringify(entry.slice(0, 8))}…)`,
      );
    }
    const key = Buffer.from(keyPart, 'base64');
    if (key.length !== KEY_BYTES) {
      throw new CredentialCryptoError(
        `CREDENTIAL_MASTER_KEYS v${version} must decode to ${KEY_BYTES} bytes (got ${key.length}) — generate with: openssl rand -base64 32`,
      );
    }
    if (keys.has(version)) {
      throw new CredentialCryptoError(
        `CREDENTIAL_MASTER_KEYS declares v${version} twice`,
      );
    }
    keys.set(version, key);
  }
  return { currentVersion: Math.max(...keys.keys()), keys };
}

/** AAD binding — the ciphertext belongs to exactly this account + type. */
function aad(providerAccountId: string, secretType: string): Buffer {
  return Buffer.from(`${providerAccountId}:${secretType}`, 'utf8');
}

export function encryptCredential(input: {
  ring: MasterKeyRing;
  providerAccountId: string;
  secretType: string;
  secret: SecretString;
}): { encryptedPayload: string; keyVersion: number } {
  const keyVersion = input.ring.currentVersion;
  const key = input.ring.keys.get(keyVersion);
  if (!key) {
    throw new CredentialCryptoError(`Master key v${keyVersion} missing`);
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  cipher.setAAD(aad(input.providerAccountId, input.secretType));
  const ciphertext = Buffer.concat([
    cipher.update(input.secret.reveal(), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    keyVersion,
    encryptedPayload: [
      FORMAT,
      iv.toString('base64'),
      tag.toString('base64'),
      ciphertext.toString('base64'),
    ].join('.'),
  };
}

export function decryptCredential(input: {
  ring: MasterKeyRing;
  providerAccountId: string;
  secretType: string;
  encryptedPayload: string;
  keyVersion: number;
}): SecretString {
  const key = input.ring.keys.get(input.keyVersion);
  if (!key) {
    throw new CredentialCryptoError(
      `No master key for version ${input.keyVersion} — was a rotation removed before re-encryption?`,
    );
  }
  const parts = input.encryptedPayload.split('.');
  if (parts.length !== 4 || parts[0] !== FORMAT) {
    throw new CredentialCryptoError('Unrecognized credential envelope format');
  }
  const [, ivB64, tagB64, ctB64] = parts;
  try {
    const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
    decipher.setAAD(aad(input.providerAccountId, input.secretType));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64')),
      decipher.final(),
    ]);
    return new SecretString(plaintext.toString('utf8'));
  } catch {
    // Auth failure: tampered ciphertext, wrong key, or an AAD mismatch
    // (payload replayed from another account row). One error, no oracle.
    throw new CredentialCryptoError(
      'Credential decryption failed (tampered, re-keyed, or replayed payload)',
    );
  }
}
