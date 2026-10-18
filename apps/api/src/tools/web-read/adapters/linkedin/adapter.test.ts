import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { WebFetchFailure, WebResponse } from '../../http-client';
import { scriptedIo, type Reply } from '../../../../testing/github-test-io';
import { createLinkedInAdapter, parseLinkedInUrl } from './adapter';

const adapter = createLinkedInAdapter({ id: 'linkedin', use: 'linkedin' });

const PROFILE = 'https://www.linkedin.com/in/asandler';
const POST =
  'https://www.linkedin.com/posts/leon0399_aiagents-developertools-softwareengineering-ugcPost-7513004942043824128-IVu5/';

function fixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf8');
}

function htmlResponse(body: string, finalUrl: string): WebResponse {
  return { finalUrl, contentType: 'text/html; charset=utf-8', body };
}

function page<Value>(json: Value, ogTitle?: string): string {
  const meta =
    ogTitle === undefined
      ? ''
      : `<meta property="og:title" content="${ogTitle}">`;
  return `<!DOCTYPE html><html><head>${meta}<script type="application/ld+json">${JSON.stringify(json)}</script></head></html>`;
}

async function read(source: string, reply: Reply, requestUrl = source) {
  const run = scriptedIo(new Map([[requestUrl, [reply]]]));
  const outcome = await adapter.read(new URL(source), run.io);
  return { outcome, requests: run.requests };
}

function rendered(
  outcome: Awaited<ReturnType<typeof read>>['outcome'],
): string {
  expect(outcome.kind).toBe('rendered');
  if (outcome.kind !== 'rendered') throw new Error('expected render');
  return outcome.content;
}

describe('LinkedIn adapter claim', () => {
  it.each([
    'https://www.linkedin.com/in/asandler',
    'https://www.linkedin.com/in/asandler/',
    'https://www.linkedin.com/in/asandler?trk=public',
    'https://linkedin.com/in/leon0399',
    'https://es.linkedin.com/in/asandler/',
    'https://ES.linkedin.com/in/abc',
    'https://www.linkedin.com/in/Jos%C3%A9-Ana',
    'https://www.linkedin.com/in/alena-air',
    POST,
    'https://www.linkedin.com/posts/leon0399_aiagents-developertools-softwareengineering-activity-7513004945395130368-ESY6',
    'https://www.linkedin.com/posts/a-share-12345678',
    'https://www.linkedin.com/posts/a-activity-12345678/',
    'https://es.linkedin.com/feed/update/urn:li:ugcPost:7513004942043824128',
    'https://www.linkedin.com/feed/update/urn:li:activity:12345678/',
    'https://www.linkedin.com/feed/update/urn:li:share:12345678?trk=1',
    'https://www.linkedin.com/feed/update/urn%3Ali%3Aactivity%3A12345678',
  ])('claims %s', (source) => {
    expect(adapter.match(new URL(source))).toBe(true);
  });

  it.each([
    'http://www.linkedin.com/in/asandler',
    'https://www.linkedin.com:8443/in/asandler',
    'https://learning.linkedin.com/in/asandler',
    'https://m.linkedin.com/in/asandler',
    'https://evil.linkedin.com.example/in/asandler',
    'https://www.linkedin.com/in/ab',
    'https://www.linkedin.com/in/asandler/details/experience',
    'https://www.linkedin.com/in/%',
    'https://www.linkedin.com/in/a%2Fb',
    'https://www.linkedin.com/company/mycouncil-xyz',
    'https://www.linkedin.com/pulse/hello',
    'https://www.linkedin.com/embed/feed/update/urn:li:ugcPost:7513004942043824128',
    'https://www.linkedin.com/posts/activity-12345678-abcd',
    'https://www.linkedin.com/posts/a-ugcpost-12345678',
    'https://www.linkedin.com/posts/a-activity-1234567',
    'https://www.linkedin.com/feed/update/urn:li:activity:1234567',
    'https://www.linkedin.com/feed/update/urn:li:member:12345678',
    'https://www.linkedin.com/feed/',
    'https://lnkd.in/abc',
  ])('leaves %s to the generic ladder', (source) => {
    expect(parseLinkedInUrl(new URL(source))).toBeUndefined();
    expect(adapter.match(new URL(source))).toBe(false);
  });
});

describe('LinkedIn adapter read', () => {
  it('renders the recorded public profile and skips masked roles and activity', async () => {
    const { outcome, requests } = await read(
      `${PROFILE}/?trk=public_profile#about`,
      htmlResponse(fixture('asandler-profile.html'), PROFILE),
      `${PROFILE}/`,
    );

    expect(requests).toStrictEqual([
      { url: `${PROFILE}/`, init: { accept: 'text/html' } },
    ]);
    expect(rendered(outcome)).toBe(ASANDLER);
    expect(rendered(outcome)).not.toContain('****');
    expect(rendered(outcome)).not.toContain('2359');
    expect(rendered(outcome)).not.toContain('2026-09-08');
    expect(rendered(outcome)).not.toContain('There is something both exciting');
  });

  it('renders the recorded public post from its JSON-LD', async () => {
    const body = fixture('leon0399-post.html');
    const { outcome, requests } = await read(
      `${POST}?trk=public_post`,
      htmlResponse(body, POST),
      POST,
    );
    const content = rendered(outcome);

    expect(requests).toStrictEqual([
      { url: POST, init: { accept: 'text/html' } },
    ]);
    expect(content).toContain(POST_HEADER);
    expect(content).toContain(
      'Last week at Madrid Tech Brunch, I was surprised by how many people asked me to share my AI tooling setup.',
    );
    expect(content).toContain('#AIAgents #DeveloperTools #SoftwareEngineering');
    expect(content).not.toContain('1281');
    expect(content.split('robust and flexible CLI harness')).toHaveLength(2);
    const media = content.slice(content.indexOf('## Media'));
    expect(media.match(/^- https:\/\/media\.licdn\.com/gmu)).toHaveLength(5);
    expect(media).toContain('D4E22AQH1xrpOnugrwg');
  });

  it('renders a fully public profile, including dates, and drops a bad affiliation', async () => {
    const source = 'https://www.linkedin.com/in/ada-example';
    const { outcome } = await read(
      source,
      htmlResponse(
        page(FULL_PROFILE, 'Ada Example - Staff engineer | LinkedIn'),
        source,
      ),
    );

    expect(rendered(outcome)).toBe(FULL_PROFILE_TEXT);
  });

  it('uses a job title when no organization is visible and ignores a masked headline', async () => {
    const source = 'https://es.linkedin.com/in/title-only';
    const { outcome } = await read(
      source,
      htmlResponse(
        page(
          {
            '@type': 'Person',
            name: 'Title Only',
            jobTitle: ['Advisor', '****'],
            worksFor: { name: '****' },
          },
          'Title Only - **** | LinkedIn',
        ),
        'https://www.linkedin.com/in/title-only',
      ),
    );

    const content = rendered(outcome);
    expect(content).toContain('Current: Advisor');
    expect(content).toContain('URL: https://es.linkedin.com/in/title-only');
    expect(content).not.toContain('Headline');
    expect(content).not.toContain('## Experience');
    expect(content).not.toContain('****');
  });

  it('reads a headline without the LinkedIn suffix and a single organization', async () => {
    const source = 'https://www.linkedin.com/in/suffix-free';
    const { outcome } = await read(
      source,
      htmlResponse(
        page(
          {
            '@type': 'Person',
            name: 'Suffix Free',
            url: 'https://www.linkedin.com/in/suffix-free',
            jobTitle: 'Founder',
            worksFor: {
              '@type': 'EducationalOrganization',
              name: 'Night School',
              member: { startDate: '2014-02', endDate: '2020-01' },
            },
            alumniOf: {
              name: 'Ended only',
              member: { endDate: 2012 },
            },
          },
          'Suffix Free - Founder',
        ),
        source,
      ),
    );

    const content = rendered(outcome);
    expect(content).toContain('Headline: Founder');
    expect(content).toContain('- Founder at Night School · 2014-02 – 2020-01');
    expect(content).toContain('## Experience');
    expect(content).not.toContain('## Education');
    expect(content).toContain('- Ended only · 2012');
    expect(content).not.toContain('present');
  });

  it('aligns each title with its organization and leaves a past start open', async () => {
    const source = 'https://www.linkedin.com/in/aligned';
    const { outcome } = await read(
      source,
      htmlResponse(
        page({
          '@type': 'Person',
          name: 'Aligned Titles',
          description: 'Hello ****',
          jobTitle: [{ bad: true }, 'Advisor'],
          worksFor: [{ name: 'First Co' }, { name: 'Second Co' }],
          alumniOf: { name: 'Old Co', member: { startDate: '2001-01' } },
        }),
        source,
      ),
    );

    const content = rendered(outcome);
    expect(content).toContain('About: Hello ****');
    expect(content).toContain('Current: First Co; Advisor at Second Co');
    expect(content).toContain('- First Co\n- Advisor at Second Co');
    expect(content).toContain('- Old Co · 2001-01');
    expect(content).not.toContain('present');
  });

  it('applies a single job title only to the first current organization', async () => {
    const source = 'https://www.linkedin.com/in/one-title';
    const { outcome } = await read(
      source,
      htmlResponse(
        page({
          '@type': 'Person',
          name: 'One Title',
          jobTitle: 'Founder',
          worksFor: [
            {
              name: 'Null Dates',
              member: {
                startDate: null,
                endDate: null,
                description: 'Still here',
              },
            },
            { name: 'Second Co' },
          ],
        }),
        source,
      ),
    );

    const content = rendered(outcome);
    expect(content).toContain('Current: Founder at Null Dates; Second Co');
    expect(content).toContain('- Founder at Null Dates\n  Still here');
    expect(content).toContain('- Second Co');
    expect(content).not.toContain('Founder at Second Co');
    expect(content).not.toContain('null');
    expect(content).not.toContain('present');
  });

  it('keeps a role when its membership block cannot be read', async () => {
    const source = 'https://www.linkedin.com/in/partial-role';
    const { outcome } = await read(
      source,
      htmlResponse(
        page({
          '@type': 'Person',
          name: 'Partial Role',
          worksFor: {
            name: 'Visible Co',
            member: { startDate: { bad: true }, description: 'Hidden with it' },
          },
        }),
        source,
      ),
    );

    const content = rendered(outcome);
    expect(content).toContain('- Visible Co');
    expect(content).not.toContain('Hidden with it');
    expect(content).not.toContain('present');
  });

  it('falls through when the profile has no public name or JSON-LD', async () => {
    const source = 'https://www.linkedin.com/in/empty-name';
    for (const body of [
      page({ '@type': 'Person', name: '**** ****' }),
      page({ '@type': 'Person', name: '   ' }),
      page({ '@type': 'DiscussionForumPosting', text: 'not a profile' }),
      '<html><script type="application/ld+json">not json</script></html>',
      page(null),
      page('nope'),
      page([]),
    ]) {
      const { outcome } = await read(source, htmlResponse(body, source));
      expect(outcome).toEqual({ kind: 'failed', failure: 'parse' });
    }
  });

  it('uses a later JSON-LD block when the first one does not parse', async () => {
    const source = 'https://www.linkedin.com/in/second-block';
    const html = `<html><head>
      <script type="application/ld+json">{</script>
      <script type="application/ld+json">${JSON.stringify({ '@type': 'Person', name: 'Second Block' })}</script>
      </head></html>`;
    const { outcome } = await read(source, htmlResponse(html, source));
    expect(rendered(outcome)).toContain('# Second Block');
  });

  it('renders a post from a graph, a text body, and both reaction schemes', async () => {
    const source = 'https://www.linkedin.com/feed/update/urn:li:share:12345678';
    const { outcome } = await read(
      source,
      htmlResponse(
        page({
          '@graph': [
            { '@type': 'Person', name: 'Not the post' },
            {
              '@type': 'DiscussionForumPosting',
              text: 'See #AIAgents and then #aiagents. a#b stays. end. #AI',
              articleBody: '   ',
              author: { name: '****', url: 'http://example.com/a' },
              datePublished: 'not-a-date',
              commentCount: -1,
              interactionStatistic: [
                {
                  interactionType: 'http://schema.org/LikeAction',
                  userInteractionCount: 2,
                },
                {
                  interactionType: 'https://schema.org/LikeAction',
                  userInteractionCount: 3,
                },
                {
                  interactionType: 'https://schema.org/FollowAction',
                  userInteractionCount: 10,
                },
                {
                  interactionType: 'https://schema.org/CommentAction',
                  userInteractionCount: 4,
                },
                {
                  interactionType: 'https://schema.org/LikeAction',
                  userInteractionCount: -5,
                },
              ],
              image: {
                contentUrl: 'https://media.licdn.com/one.jpg',
                caption: 'line\n\nnext',
                description: 'not shown',
              },
            },
          ],
        }),
        source,
      ),
    );

    expect(rendered(outcome)).toBe(GRAPH_POST);
  });

  it('prefers article text, a direct comment count, and an https canonical URL', async () => {
    const source = 'https://www.linkedin.com/posts/a-activity-12345678-abcd';
    const { outcome } = await read(
      source,
      htmlResponse(
        page([
          {
            '@type': 'SocialMediaPosting',
            '@id': 'http://example.com/not-this',
            url: 'https://www.linkedin.com/posts/a-activity-12345678-abcd',
            articleBody: 'Public body',
            text: 'Other body',
            commentCount: 1,
            author: { name: 'Author Name' },
            datePublished: '****',
            interactionStatistic: {
              interactionType: 'https://schema.org/CommentAction',
              userInteractionCount: 9,
            },
            image: [
              { url: 'javascript:alert(1)', caption: 'nope' },
              { url: 'http://cdn.example/a.jpg' },
              {
                description: 'caption only',
                url: 'https://media.licdn.com/ok.jpg',
              },
            ],
          },
        ]),
        source,
      ),
    );

    const content = rendered(outcome);
    expect(content).toContain('# Author Name');
    expect(content).toContain('Author: Author Name');
    expect(content).not.toContain('http://example.com');
    expect(content).toContain(`URL: ${source}`);
    expect(content).toContain('Public body');
    expect(content).not.toContain('Other body');
    expect(content).toContain('Comments: 1');
    expect(content).not.toContain('Comments: 9');
    expect(content).not.toContain('Date:');
    expect(content).not.toContain('javascript:');
    expect(content).not.toContain('http://cdn.example');
    expect(content).toContain('- https://media.licdn.com/ok.jpg');
    expect(content).toContain('  caption only');
  });

  it('falls through a post page with no posting', async () => {
    const source = 'https://www.linkedin.com/posts/a-activity-12345678';
    const { outcome } = await read(
      source,
      htmlResponse(page({ '@type': 'Person', name: 'Ada' }), source),
    );
    expect(outcome).toEqual({ kind: 'failed', failure: 'parse' });
  });

  it('keeps a zero count and skips a statistic or image that is not an object', async () => {
    const source = 'https://www.linkedin.com/posts/a-share-12345678-zero';
    const { outcome } = await read(
      source,
      htmlResponse(
        page({
          '@type': 'SocialMediaPosting',
          commentCount: 0,
          articleBody: 'Hello ****',
          interactionStatistic: [
            null,
            {
              interactionType: 'https://schema.org/LikeAction',
              userInteractionCount: 0,
            },
            {
              interactionType: 'https://schema.org/CommentAction',
              userInteractionCount: 9,
            },
          ],
          image: [null, { url: 'https://media.licdn.com/ok.jpg' }],
        }),
        source,
      ),
    );

    const content = rendered(outcome);
    expect(content).toContain('Reactions: 0');
    expect(content).toContain('Comments: 0');
    expect(content).not.toContain('Comments: 9');
    expect(content).toContain('Hello ****');
    expect(content).toContain('- https://media.licdn.com/ok.jpg');
    expect(content).not.toContain('null');
  });

  it('omits a null comment count instead of printing it', async () => {
    const source = 'https://www.linkedin.com/posts/a-activity-87654321-none';
    const { outcome } = await read(
      source,
      htmlResponse(
        page({
          '@type': 'SocialMediaPosting',
          commentCount: null,
          interactionStatistic: {
            interactionType: 'https://schema.org/LikeAction',
            userInteractionCount: null,
          },
        }),
        source,
      ),
    );

    const content = rendered(outcome);
    expect(content).not.toContain('Comments');
    expect(content).not.toContain('Reactions');
    expect(content).not.toContain('null');
  });

  it('names a post with no author and still records the requested URL', async () => {
    const source = 'https://www.linkedin.com/posts/a-share-12345678-zzzz';
    const { outcome } = await read(
      source,
      htmlResponse(
        page({ '@type': 'SocialMediaPosting', image: { url: 'not a url' } }),
        source,
      ),
    );
    expect(rendered(outcome)).toBe(`# LinkedIn post\n\nURL: ${source}`);
  });

  it('does not fetch a URL it does not claim', async () => {
    const run = scriptedIo(new Map());
    const outcome = await adapter.read(
      new URL('https://www.linkedin.com/company/acme'),
      run.io,
    );
    expect(outcome).toEqual({ kind: 'failed', failure: 'parse' });
    expect(run.requests).toEqual([]);
  });

  it('falls through an authwall, a login redirect, and a non-LinkedIn final URL', async () => {
    const source = 'https://www.linkedin.com/in/leon0399';
    const authwall: WebFetchFailure = {
      type: 'http_status',
      message: 'The server answered HTTP 999.',
      httpStatus: 999,
    };
    const blocked = await read(source, authwall);
    expect(blocked.outcome).toEqual({ kind: 'failed', failure: 'status' });

    const limited: WebFetchFailure = {
      type: 'http_status',
      message: 'The server answered HTTP 429.',
      httpStatus: 429,
    };
    const throttled = await read(source, limited);
    expect(throttled.outcome).toEqual({
      kind: 'failed',
      failure: 'rate_limit',
    });

    const timeout: WebFetchFailure = {
      type: 'call_timeout',
      message: 'The web read reached its deadline.',
    };
    const spent = await read(source, timeout);
    expect(spent.outcome).toMatchObject({
      kind: 'failed',
      failure: 'transport',
      fatal: timeout,
    });

    for (const finalUrl of [
      'https://www.linkedin.com/authwall?trk=bf',
      'https://www.linkedin.com/authwall/next',
      'https://www.linkedin.com/login',
      'https://www.linkedin.com/login/foo',
      'https://www.linkedin.com/uas/login',
      'http://www.linkedin.com/in/leon0399',
      'https://example.com/in/leon0399',
      'not a url',
    ]) {
      const { outcome } = await read(
        source,
        htmlResponse(
          page({ '@type': 'Person', name: 'Should Not Render' }),
          finalUrl,
        ),
      );
      expect(outcome).toEqual({ kind: 'failed', failure: 'status' });
    }
  });

  it('accepts a final URL that only shares a prefix with a login path', async () => {
    const source = 'https://www.linkedin.com/in/still-public';
    const { outcome } = await read(
      source,
      htmlResponse(
        page({ '@type': 'Person', name: 'Still Public' }),
        'https://www.linkedin.com/login-help',
      ),
    );
    expect(rendered(outcome)).toContain('# Still Public');

    const usage = await read(
      source,
      htmlResponse(
        page({ '@type': 'Person', name: 'Usage Page' }),
        'https://fr.linkedin.com/usage',
      ),
    );
    expect(rendered(usage.outcome)).toContain('# Usage Page');
  });
});

const ASANDLER = `# Arkady S.

Headline: myCouncil
Location: Madrid, Community of Madrid, Spain
Current: myCouncil
About: I am a Founder of True Click Technologies, where we develop state-of-the-art AI-powered…
URL: https://es.linkedin.com/in/asandler

## Experience
- myCouncil (https://www.linkedin.com/company/mycouncil-xyz)

## Education
- The Institute of Directors (https://uk.linkedin.com/school/institute-of-directors/) · 2021-05 – 2021-11`;

const POST_HEADER = `# Leonid Meleshin

Author: Leonid Meleshin (https://es.linkedin.com/in/leon0399)
Date: 2026-10-05T22:39:23.862Z
Reactions: 6
Comments: 0
Hashtags: #AIAgents, #DeveloperTools, #SoftwareEngineering
URL: https://www.linkedin.com/posts/leon0399_aiagents-developertools-softwareengineering-activity-7513004945395130368-ESY6`;

const FULL_PROFILE = {
  '@type': 'Person',
  name: 'Ada Example',
  url: 'http://insecure.example/in/ada',
  description: 'Builds things.\nSecond line',
  jobTitle: ['Engineer', '****'],
  address: { addressLocality: 'Paris, France' },
  worksFor: {
    '@type': 'Organization',
    name: 'Example Co',
    url: 'https://www.linkedin.com/company/example',
    location: 'Paris',
    member: { startDate: 2020, description: 'Leads the lab' },
  },
  alumniOf: [
    {
      '@type': 'Organization',
      name: 'Past Co',
      member: { startDate: '2010-01', endDate: '2019-12' },
    },
    {
      '@type': 'EducationalOrganization',
      name: 'Example University',
      url: 'https://www.linkedin.com/school/example/',
      member: { startDate: 2006, endDate: 2010 },
    },
    { '@type': 'Organization', name: '**** ****' },
    { name: 12 },
  ],
};

const FULL_PROFILE_TEXT = `# Ada Example

Headline: Staff engineer
Location: Paris, France
Current: Engineer at Example Co
About: Builds things. Second line
URL: https://www.linkedin.com/in/ada-example

## Experience
- Engineer at Example Co (https://www.linkedin.com/company/example) · Paris · 2020 – present
  Leads the lab
- Past Co · 2010-01 – 2019-12

## Education
- Example University (https://www.linkedin.com/school/example/) · 2006 – 2010`;

const GRAPH_POST = `# LinkedIn post

Reactions: 5
Comments: 4
Hashtags: #AIAgents, #AI
URL: https://www.linkedin.com/feed/update/urn:li:share:12345678

See #AIAgents and then #aiagents. a#b stays. end. #AI

## Media
- https://media.licdn.com/one.jpg
  line

  next`;
