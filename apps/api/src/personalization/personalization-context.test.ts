import { type Personalization } from '../db/schema';
import { resolvePromptUserInput } from './personalization-context';

const profile = (
  overrides: Partial<Personalization> = {},
): Personalization => ({
  userId: 'user-1',
  preferredName: null,
  about: null,
  responsePreferences: null,
  enabled: true,
  shareAccountIdentity: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const account = { name: 'Leonid Meleshin', email: 'leo@example.com' };

describe('resolvePromptUserInput', () => {
  it('renders authored content for a profile with the default toggles', () => {
    expect(
      resolvePromptUserInput({
        personalization: profile({
          preferredName: 'Leo',
          about: 'Builds llame',
        }),
        account,
      }),
    ).toEqual({
      preferredName: 'Leo',
      about: 'Builds llame',
      // Normalized to undefined, not carried through as the stored null.
      responsePreferences: undefined,
    });
  });

  it('withholds account identity until the owner opts in', () => {
    // shareAccountIdentity defaults false, so neither key is even present —
    // absent, not empty, because the loader keys omission off `undefined`.
    const withheld = resolvePromptUserInput({
      personalization: profile({ preferredName: 'Leo' }),
      account,
    });
    expect(withheld).not.toHaveProperty('name');
    expect(withheld).not.toHaveProperty('email');

    expect(
      resolvePromptUserInput({
        personalization: profile({
          preferredName: 'Leo',
          shareAccountIdentity: true,
        }),
        account,
      }),
    ).toMatchObject({ name: 'Leonid Meleshin', email: 'leo@example.com' });
  });

  it('disabling personalization stops identity injection too', () => {
    // `enabled` is the master switch, not a switch over authored text only: an
    // owner turning personalization off is not opting into having their email
    // sent instead.
    expect(
      resolvePromptUserInput({
        personalization: profile({
          preferredName: 'Leo',
          enabled: false,
          shareAccountIdentity: true,
        }),
        account,
      }),
    ).toBeUndefined();
  });

  it('treats a brand-new user as enabled with identity withheld', () => {
    // No row means the column defaults apply: enabled true, sharing false. So
    // anything they author works immediately, and nothing account-derived is
    // transmitted until they ask for it.
    const resolved = resolvePromptUserInput({
      personalization: undefined,
      account,
    });

    expect(resolved).toBeDefined();
    expect(resolved).not.toHaveProperty('name');
    expect(resolved).not.toHaveProperty('email');
    expect(resolved?.preferredName).toBeUndefined();
  });

  it('an absent row and a row with nothing authored behave identically', () => {
    expect(
      resolvePromptUserInput({ personalization: undefined, account }),
    ).toEqual(resolvePromptUserInput({ personalization: profile(), account }));
  });
});
