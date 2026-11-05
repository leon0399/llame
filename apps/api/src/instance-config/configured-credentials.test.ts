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
});
