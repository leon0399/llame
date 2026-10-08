import { describe, expect, it } from 'vitest';

import type { WebFetchFailure } from '../../http-client';
import {
  API_ORIGIN,
  response,
  scriptedIo,
  type Reply,
} from '../../../../testing/github-test-io';
import { createOsvAdapter } from './adapter';

const adapter = createOsvAdapter(
  { id: 'advisories', use: 'osv' },
  { apiOrigin: API_ORIGIN },
);
const NOT_FOUND: WebFetchFailure = {
  type: 'http_status',
  message: 'HTTP 404',
  httpStatus: 404,
};
const GHSA = 'GHSA-jfh8-c2jp-5v3q';

async function read(source: string, reply: Reply, id = GHSA) {
  const url = `${API_ORIGIN}/v1/vulns/${encodeURIComponent(id)}`;
  const run = scriptedIo(new Map([[url, [reply]]]));
  const outcome = await adapter.read(new URL(source), run.io);
  return { outcome, urls: run.requests.map((request) => request.url) };
}

describe('OSV adapter claim', () => {
  it.each([
    [`https://osv.dev/vulnerability/${GHSA}`, GHSA],
    ['https://osv.dev/vulnerability/PYSEC-2021-19/', 'PYSEC-2021-19'],
    ['https://osv.dev/vulnerability/RUSTSEC-2021-0001', 'RUSTSEC-2021-0001'],
    ['https://nvd.nist.gov/vuln/detail/CVE-2021-44228', 'CVE-2021-44228'],
    [`https://github.com/advisories/${GHSA}`, GHSA],
    ['https://www.cve.org/CVERecord?id=CVE-2021-44228', 'CVE-2021-44228'],
    ['https://osv.dev/vulnerability/RHSA-2022%3A0001', 'RHSA-2022:0001'],
  ])('claims %s as %s', async (source, id) => {
    expect(adapter.match(new URL(source))).toBe(true);
    const { urls } = await read(source, NOT_FOUND, id);
    expect(urls).toStrictEqual([
      `${API_ORIGIN}/v1/vulns/${encodeURIComponent(id)}`,
    ]);
  });

  it.each([
    'http://osv.dev/vulnerability/CVE-2021-44228',
    'https://osv.dev/list',
    'https://osv.dev/vulnerability/',
    'https://nvd.nist.gov/vuln/detail/GHSA-jfh8-c2jp-5v3q',
    'https://github.com/advisories',
    'https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
    'https://github.com/acme/project/security/advisories/GHSA-jfh8-c2jp-5v3q',
    'https://www.cve.org/CVERecord?id=log4shell',
    'https://example.com/vulnerability/CVE-2021-44228',
  ])('leaves %s to the generic ladder', (source) => {
    expect(adapter.match(new URL(source))).toBe(false);
  });
});

describe('OSV adapter read', () => {
  it('renders the advisory header, affected ranges, details, and references', async () => {
    const { outcome } = await read(
      `https://github.com/advisories/${GHSA}`,
      response({
        id: GHSA,
        summary: 'Remote code injection in Log4j',
        details: 'Log4j versions prior to 2.16.0 are affected.\n',
        aliases: ['CVE-2021-44228'],
        published: '2021-12-10T00:40:56Z',
        modified: '2025-10-22T19:37:02Z',
        severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L' }],
        database_specific: { severity: 'CRITICAL', cwe_ids: ['CWE-502'] },
        affected: [
          {
            package: {
              ecosystem: 'Maven',
              name: 'org.apache.logging.log4j:log4j-core',
            },
            ranges: [
              {
                type: 'ECOSYSTEM',
                events: [{ introduced: '2.13.0' }, { fixed: '2.15.0' }],
              },
              {
                type: 'GIT',
                repo: 'https://github.com/apache/logging-log4j2',
                events: [{ introduced: '0' }, { fixed: 'abc123' }],
              },
            ],
          },
          {
            ranges: [
              {
                type: 'GIT',
                repo: 'https://github.com/apache/logging-log4j2',
                events: [{ introduced: '0' }],
              },
            ],
          },
          { package: { ecosystem: 'Debian:12', name: 'log4j' } },
          {
            package: { ecosystem: 'npm', name: 'left-pad' },
            versions: ['1.0.0', '1.0.1'],
            severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:L' }],
          },
        ],
        references: [{ type: 'ADVISORY', url: 'https://nvd.example/CVE' }],
      }),
    );

    expect(outcome).toStrictEqual({
      kind: 'rendered',
      mediaType: 'text/markdown',
      notes: [],
      content: [
        `# ${GHSA}: Remote code injection in Log4j`,
        '',
        'Aliases: CVE-2021-44228',
        'Severity: CRITICAL; CVSS:3.1/AV:N/AC:L; CVSS:3.1/AV:L',
        'CWE: CWE-502',
        'Published: 2021-12-10T00:40:56Z',
        'Modified: 2025-10-22T19:37:02Z',
        `URL: https://osv.dev/vulnerability/${GHSA}`,
        '',
        '## Affected',
        '',
        '- Maven org.apache.logging.log4j:log4j-core: introduced 2.13.0, fixed 2.15.0',
        '- Maven org.apache.logging.log4j:log4j-core GIT https://github.com/apache/logging-log4j2: introduced 0, fixed abc123',
        '- GIT https://github.com/apache/logging-log4j2: introduced 0',
        '- Debian:12 log4j',
        '- npm left-pad: versions 1.0.0, 1.0.1',
        '',
        '## Details',
        '',
        'Log4j versions prior to 2.16.0 are affected.',
        '',
        '## References',
        '',
        '- ADVISORY: https://nvd.example/CVE',
      ].join('\n'),
    });
  });

  it('marks a withdrawn advisory and lists related ids', async () => {
    const { outcome } = await read(
      `https://osv.dev/vulnerability/${GHSA}`,
      response({
        id: GHSA,
        withdrawn: '2024-01-01T00:00:00Z',
        related: ['R-1', 'R-2'],
      }),
    );

    expect(outcome).toMatchObject({
      kind: 'rendered',
      content: [
        `# ${GHSA}`,
        '',
        'Withdrawn: 2024-01-01T00:00:00Z',
        'Related: R-1, R-2',
        `URL: https://osv.dev/vulnerability/${GHSA}`,
      ].join('\n'),
    });
  });

  it('falls through on a missing advisory or a malformed payload', async () => {
    const source = `https://osv.dev/vulnerability/${GHSA}`;

    await expect(read(source, NOT_FOUND)).resolves.toMatchObject({
      outcome: { kind: 'failed', failure: 'status' },
    });
    await expect(
      read(source, response({ summary: 'x' })),
    ).resolves.toMatchObject({ outcome: { kind: 'failed', failure: 'parse' } });
  });
});
