/**
 * URL scanning tests for the configured credential set (openspec/changes/
 * instance-config, design D1). Each case pins one branch of the raw-string
 * scanner that decides whether a URL contributes a userinfo or query member;
 * the loader-level tests in config-loader.test.ts cover the field plumbing.
 */
import { interpolateStringWithSubstitutions } from '@workspace/config-interpolation';

import { ConfiguredCredentialCollector } from './configured-credentials';

function urlMembers(
  url: string,
  env: NodeJS.ProcessEnv = {},
): ReadonlyArray<string> {
  const collector = new ConfiguredCredentialCollector({});
  collector.addUrlMembers(interpolateStringWithSubstitutions(url, env));
  return collector.snapshot();
}

function postgresMembers(postgresUrl: string): ReadonlyArray<string> {
  return new ConfiguredCredentialCollector({
    POSTGRES_URL: postgresUrl,
  }).snapshot();
}

describe('ConfiguredCredentialCollector — URL members', () => {
  it('skips a query value that decodes to whitespace', () => {
    expect(urlMembers('https://gw.example/v1?apiKey=%20')).toEqual(['%20']);
  });

  it('ignores a substitution that starts in the userinfo password and ends past it', () => {
    // The resolved URL `https://svc:abc@gw.example/v1` reads the last `@`
    // before the path as its userinfo end, so the password is `abc` and the
    // substitution's host suffix is not part of the URL's credentials.
    expect(
      urlMembers('https://svc:{env:PW}/v1', { PW: 'abc@gw.example' }),
    ).toEqual(['abc']);
  });

  it('reads the query of a scheme that has no authority, and no userinfo', () => {
    expect(urlMembers('urn:svc:pw-canary@host/path?apiKey=x')).toEqual(['x']);
  });

  it('takes a userinfo password from a slashless http URL', () => {
    expect(urlMembers('http:svc:pw-canary@host/v1')).toEqual(['pw-canary']);
  });

  it('ends the authority at the first delimiter, never at an @ after it', () => {
    expect(urlMembers('https://gw.example/v1?apiKey=abc@def')).toEqual([
      'abc@def',
    ]);
  });

  it('does not treat an @ one character past the authority delimiter as userinfo', () => {
    expect(urlMembers('https://gw.example/@?apiKey=abc')).toEqual(['abc']);
  });

  it('skips a backslash authority prefix the way the URL parser does', () => {
    expect(urlMembers(String.raw`https:\\svc:pw-canary@host/v1`)).toEqual([
      'pw-canary',
    ]);
  });

  it('takes a username-only userinfo from a URL with a port', () => {
    expect(urlMembers('https://longusr8@gw.internal:8443/v1')).toEqual([
      'longusr8',
    ]);
  });

  it('rejects a scheme that only ends with a valid scheme', () => {
    expect(urlMembers('1https://svc:pw-canary@host/v1')).toEqual([]);
  });

  it('rejects a scheme that only starts with a valid scheme', () => {
    expect(urlMembers('https?://svc:pw-canary@host/v1')).toEqual([]);
  });

  it('ends the authority at the nearest delimiter, not the last one present', () => {
    // `?` occurs after the path `@`; only the nearer `/` after the host ends
    // the authority, so the path `@` is not userinfo.
    expect(urlMembers('https://gw.example/a@b/v1?apiKey=secret')).toEqual([
      'secret',
    ]);
  });

  it('reads a literal URL that begins with whitespace', () => {
    expect(
      urlMembers('  https://svc:pw-canary@gw.example/v1?apiKey=qs-canary'),
    ).toEqual(['pw-canary', 'qs-canary']);
  });

  it('adds the spelling WHATWG parsing transmits, without tab, LF, or CR', () => {
    // `new URL` removes ASCII tab, LF, and CR anywhere in its input, so a
    // consumer receives `pw-canarysecret` for a password written across a line.
    expect(urlMembers('https://svc:pw-canary\nsecret@gw.example/v1')).toEqual([
      'pw-canary\nsecret',
      'pw-canarysecret',
    ]);
  });

  it('strips tab and CR from a credential-shaped query value', () => {
    expect(
      urlMembers('https://gw.example/v1?apiKey=qs\tcanary\rsecret'),
    ).toEqual(['qs\tcanary\rsecret', 'qscanarysecret']);
  });

  it('reads a slashless http URL that begins with whitespace', () => {
    expect(urlMembers(' \thttp:svc:pw-canary@host/v1')).toEqual(['pw-canary']);
  });

  it('reads an {env:} URL whose value begins with whitespace', () => {
    expect(
      urlMembers('{env:BASE_URL}', {
        BASE_URL: '  https://svc:pw-canary@gw.example/v1?apiKey=qs-canary',
      }),
    ).toEqual(['pw-canary', 'qs-canary']);
  });

  it('reads the password of a whitespace-prefixed POSTGRES_URL', () => {
    expect(
      postgresMembers('  postgres://app:pw-canary@db.example:5432/app'),
    ).toContain('pw-canary');
  });

  it('adds a query substitution in written and percent-decoded spellings', () => {
    expect(
      urlMembers('https://gw.example/v1?auth={env:AUTH}', {
        AUTH: 'secret%2Fcanary',
      }),
    ).toEqual(['secret%2Fcanary', 'secret/canary']);
  });

  it('adds a userinfo password substitution in written and percent-decoded spellings', () => {
    expect(
      urlMembers('https://svc:{env:PW}@gw.example/v1', {
        PW: 'pw%2Fcanary',
      }),
    ).toEqual(['pw%2Fcanary', 'pw/canary']);
  });

  it('does not percent-decode a header substitution', () => {
    const collector = new ConfiguredCredentialCollector({});
    collector.addHeaderValue(
      'x-trace',
      interpolateStringWithSubstitutions('{env:TRACE}', {
        TRACE: 'trace%2Fcanary',
      }),
      false,
    );
    expect(collector.snapshot()).toEqual(['trace%2Fcanary']);
  });
});
