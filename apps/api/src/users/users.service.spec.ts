import { toPublicUser } from './users.service';
import type { User } from '../db/schema';

const userWithSecret: User = {
  id: 'u1',
  name: 'Alice',
  email: 'alice@example.com',
  emailVerified: null,
  image: null,
  password: '$2b$10$SECRETHASH',
};

describe('toPublicUser', () => {
  it('strips the password field', () => {
    const pub = toPublicUser(userWithSecret);
    expect(pub).not.toHaveProperty('password');
    expect(pub.id).toBe('u1');
    expect(pub.email).toBe('alice@example.com');
  });

  it('allowlists — an unknown/future secret column is NOT forwarded (fail closed)', () => {
    const withFutureSecrets = {
      ...userWithSecret,
      totpSecret: 'TOTP_SECRET',
      apiKey: 'API_KEY',
    } as unknown as User;
    const pub = toPublicUser(withFutureSecrets);
    expect(Object.keys(pub).sort()).toEqual([
      'email',
      'emailVerified',
      'id',
      'image',
      'name',
    ]);
    expect(JSON.stringify(pub)).not.toContain('TOTP_SECRET');
    expect(JSON.stringify(pub)).not.toContain('API_KEY');
  });
});
