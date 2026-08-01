import { createHash } from 'node:crypto';
import { SessionTokenService } from './session-token.service';

describe('SessionTokenService', () => {
  it('generates a 32-byte opaque token encoded as unpadded base64url', () => {
    const service = new SessionTokenService();

    const token = service.generateToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('hashes tokens with SHA-256 hex for at-rest lookup', () => {
    const service = new SessionTokenService();

    expect(service.hashToken('raw-session-token')).toBe(
      createHash('sha256').update('raw-session-token').digest('hex'),
    );
  });
});
