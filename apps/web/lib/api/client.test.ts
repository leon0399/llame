import { afterEach, describe, expect, it } from 'vitest';
import { buildApiUrl } from './client';

describe('buildApiUrl', () => {
  const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

  afterEach(() => {
    if (originalApiUrl === undefined) {
      delete process.env.NEXT_PUBLIC_API_URL;
    } else {
      process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
    }
  });

  it('builds absolute api URLs from NEXT_PUBLIC_API_URL', () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com/';

    expect(buildApiUrl('/auth/v1/me')).toBe('https://api.example.com/auth/v1/me');
    expect(buildApiUrl('api/v1/chats')).toBe('https://api.example.com/api/v1/chats');
  });
});
