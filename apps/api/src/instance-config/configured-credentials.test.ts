/**
 * Unit tests for the configured credential set (openspec change
 * redact-configured-credentials): the positions that contribute members
 * (`addSecret`, `addSubstitutions`, the environment seed) and the G3 gate.
 * The loader-level tests in config-loader.test.ts cover where each position is
 * wired.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { interpolateStringWithSubstitutions } from '@workspace/config-interpolation';

import { ConfiguredCredentialCollector } from './configured-credentials';

function membersOf(
  add: (collector: ConfiguredCredentialCollector) => void,
  env: NodeJS.ProcessEnv = {},
): ReadonlyArray<string> {
  const collector = new ConfiguredCredentialCollector(env);
  add(collector);
  return collector.snapshot();
}

function secretMembers(
  value: string,
  env: NodeJS.ProcessEnv = {},
): ReadonlyArray<string> {
  return membersOf(
    (collector) =>
      collector.addSecret(interpolateStringWithSubstitutions(value, env)),
    env,
  );
}

function substitutionMembers(
  value: string,
  env: NodeJS.ProcessEnv = {},
): ReadonlyArray<string> {
  return membersOf(
    (collector) =>
      collector.addSubstitutions(
        interpolateStringWithSubstitutions(value, env),
      ),
    env,
  );
}

function tempJson(serialized: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'llame-credentials-'));
  const file = path.join(dir, 'secret.json');
  writeFileSync(file, serialized);
  return file;
}

describe('ConfiguredCredentialCollector — G3 gate', () => {
  it.each([
    ['a 15-character value', '0123456789abcde', []],
    [
      'a 16-character value with 16 distinct characters',
      '0123456789abcdef',
      ['0123456789abcdef'],
    ],
    ['a 16-character value just below 64 bits', '0123456789abcdea', []],
    [
      'a 17-character value above 64 bits',
      '0123456789abcdefX',
      ['0123456789abcdefX'],
    ],
    ['a low-entropy 16-character value', 'aaaaaaaaaaaaaaaa', []],
  ])('keeps %s only when it passes', (_title, value, expected) => {
    expect(secretMembers(value)).toEqual(expected);
  });
  it('keeps both a padded secret and its trimmed spelling', () => {
    const value = '  0123456789abcdef  ';
    expect(secretMembers(value)).toEqual([value, value.trim()]);
  });

  it('applies the gate to PGPASSWORD', () => {
    expect(membersOf(() => {}, { PGPASSWORD: 'short-pgpass' })).toEqual([]);
    expect(
      membersOf(() => {}, { PGPASSWORD: 'pgpass-canary-9f3a2b7c' }),
    ).toEqual(['pgpass-canary-9f3a2b7c']);
  });
});

describe('ConfiguredCredentialCollector — POSTGRES_URL', () => {
  it('takes the password in both written and percent-decoded spellings, never the whole URL', () => {
    const url = 'postgres://app:pw%2Fcanary-1065-long@db.example:5432/llame';
    const members = membersOf(() => {}, { POSTGRES_URL: url });

    expect(members).toEqual(
      expect.arrayContaining(['pw%2Fcanary-1065-long', 'pw/canary-1065-long']),
    );
    expect(members).not.toContain(url);
    expect(members).not.toContain('app');
  });

  it.each([
    ['multi-host', 'postgres://app:pw-canary-1065-long@h1:5432,h2:5432/llame'],
    [
      'socket',
      'postgres://app:pw-canary-1065-long@/llame?host=/var/run/postgresql',
    ],
    [
      'an @ in the path',
      'postgres://app:pw-canary-1065-long@db.example/llame@copy',
    ],
  ])('reads the password from the %s form', (_title, url) => {
    const members = membersOf(() => {}, { POSTGRES_URL: url });

    expect(members).toContain('pw-canary-1065-long');
    expect(members).not.toContain(url);
  });

  it.each([
    ['no userinfo', 'postgres://db.example:5432/llame'],
    ['no password', 'postgres://app@db.example:5432/llame'],
    ['no scheme separator', 'postgres:app:0123456789abcdef@db/llame'],
    ['a blank value', '   '],
  ])('adds nothing for %s', (_title, url) => {
    expect(membersOf(() => {}, { POSTGRES_URL: url })).toEqual([]);
  });

  it.each([
    [
      'an @ right after the authority',
      'postgres://app:pw-canary-1065-long@db/@x',
    ],
    ['a query and no path', 'postgres://app:pw-canary-1065-long@db?ssl=true'],
    ['no path and no query', 'postgres://app:pw-canary-1065-long@db'],
    [
      'a query before the path',
      'postgres://app:pw-canary-1065-long@db?opt=a@b/c',
    ],
    [
      'a path before the query',
      'postgres://app:pw-canary-1065-long@db/x?opt=a@b',
    ],
  ])('ends the userinfo at the first delimiter for %s', (_title, url) => {
    expect(membersOf(() => {}, { POSTGRES_URL: url })).toEqual([
      'pw-canary-1065-long',
    ]);
  });

  it('adds nothing when no @ precedes the path', () => {
    expect(
      membersOf(() => {}, {
        POSTGRES_URL: 'postgres://db.example:0123456789abcdefghij/llame',
      }),
    ).toEqual([]);
  });

  it('keeps the written password when it is not valid percent-encoding', () => {
    expect(
      membersOf(() => {}, {
        POSTGRES_URL: 'postgres://app:pw-%E0%A4%A-canary-1065@db/llame',
      }),
    ).toEqual(['pw-%E0%A4%A-canary-1065']);
  });

  it('applies the gate to the database password', () => {
    expect(
      membersOf(() => {}, {
        POSTGRES_URL: 'postgres://app:short@db.example/llame',
      }),
    ).toEqual([]);
  });

  it('reads only the environment it was given', () => {
    process.env.POSTGRES_URL = 'postgres://app:pw-canary-1065-long@db/llame';
    try {
      expect(membersOf(() => {})).toEqual([]);
    } finally {
      delete process.env.POSTGRES_URL;
    }
  });
});

describe('ConfiguredCredentialCollector — addSecret', () => {
  it('takes the whole resolved value and never a substitution inside it', () => {
    expect(
      secretMembers('secret-prefix-{env:VERSION}-secret-suffix', {
        VERSION: '1',
      }),
    ).toEqual(['secret-prefix-1-secret-suffix']);
  });

  it('takes the credential-shaped document leaves of a selected document', () => {
    const file = tempJson(
      JSON.stringify({
        tokens: {
          access_token: 'at-1234567890abcdef',
          refresh_token: 'rt-1234567890abcdef',
          note: 'note-canary-9f3a2b7c',
        },
      }),
    );

    const members = secretMembers(`{path:${file}|json:/tokens/access_token}`);

    expect(members).toEqual(
      expect.arrayContaining(['at-1234567890abcdef', 'rt-1234567890abcdef']),
    );
    expect(members).not.toContain('note-canary-9f3a2b7c');
  });

  it('applies the gate to a document leaf without skipping its sibling', () => {
    const file = tempJson(
      JSON.stringify({
        tokens: { access_token: 'at-1', refresh_token: 'rt-1234567890abcdef' },
      }),
    );

    expect(secretMembers(`{path:${file}|json:/tokens/access_token}`)).toEqual([
      'rt-1234567890abcdef',
    ]);
  });
});

describe('ConfiguredCredentialCollector — addSubstitutions', () => {
  it('takes the substitution value and never literal text around it', () => {
    const members = substitutionMembers('Bearer {env:TOKEN}', {
      TOKEN: 'mcp-header-canary-9f3a',
    });

    expect(members).toEqual(['mcp-header-canary-9f3a']);
    expect(members).not.toContain('Bearer');
    expect(members).not.toContain('Bearer ');
  });
  it('keeps both spellings of a padded header substitution', () => {
    const value = '  0123456789abcdef  ';
    expect(substitutionMembers('{env:TOKEN}', { TOKEN: value })).toEqual([
      value,
      value.trim(),
    ]);
  });

  it('skips :- fallback text even when it would pass the gate', () => {
    expect(substitutionMembers('{env:UNSET:-fallback-canary-9f3a2b}')).toEqual(
      [],
    );
  });

  it('takes the document leaves of a selected document', () => {
    const file = tempJson(
      JSON.stringify({
        token: 'tk-1234567890abcdef',
        password: 'pw-1234567890abcdef',
        region: 'region-canary-9f3a',
      }),
    );

    const members = substitutionMembers(`{path:${file}|json:/token}`);

    expect(members).toEqual(
      expect.arrayContaining(['tk-1234567890abcdef', 'pw-1234567890abcdef']),
    );
    expect(members).not.toContain('region-canary-9f3a');
  });
});
