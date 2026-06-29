import { UsersController } from './users.controller';
import { UsersService, toPublicUser } from './users.service';
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
});

describe('UsersController — never leaks the password hash', () => {
  const service = {
    getUserById: jest.fn().mockResolvedValue(userWithSecret),
    getUserByEmail: jest.fn().mockResolvedValue(userWithSecret),
    createUser: jest.fn().mockResolvedValue(userWithSecret),
  } as unknown as UsersService;
  const controller = new UsersController(service);

  it('getUserById omits password', async () => {
    const res = await controller.getUserById('u1');
    expect(res).toBeDefined();
    expect(res).not.toHaveProperty('password');
    expect(JSON.stringify(res)).not.toContain('SECRETHASH');
  });

  it('getUserByEmail omits password', async () => {
    const res = await controller.getUserByEmail('alice@example.com');
    expect(res).not.toHaveProperty('password');
    expect(JSON.stringify(res)).not.toContain('SECRETHASH');
  });

  it('createUser omits password', async () => {
    const res = await controller.createUser({ email: 'alice@example.com' });
    expect(res).not.toHaveProperty('password');
    expect(JSON.stringify(res)).not.toContain('SECRETHASH');
  });
});
