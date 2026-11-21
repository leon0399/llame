import { type ProjectLocator, parseProjectLocator } from './project-locator';

const PROJECT_ID = '0190f5e2-7c1a-7b3e-9d4f-2a6b8c0d1e2f';
const OTHER_PROJECT_ID = '0190f5e2-7c1a-7b3e-9d4f-2a6b8c0d1e2e';
const CANONICAL = `projects://${PROJECT_ID}`;

function detail(projectId: string, selector?: string): ProjectLocator {
  return {
    kind: 'detail',
    projectId,
    canonical: `projects://${projectId}`,
    selector,
  };
}

function listing(
  archived: boolean,
  canonical: string,
  selector?: string,
): ProjectLocator {
  return { kind: 'listing', archived, canonical, selector };
}

describe('parseProjectLocator', () => {
  it('accepts the active root and its root alias as one listing', () => {
    expect(parseProjectLocator('projects://')).toStrictEqual(
      listing(false, 'projects://'),
    );
    expect(parseProjectLocator('projects:///')).toStrictEqual(
      listing(false, 'projects://'),
    );
    // The scheme matches without ASCII case sensitivity.
    expect(parseProjectLocator('PROJECTS://')).toStrictEqual(
      listing(false, 'projects://'),
    );
    expect(parseProjectLocator('Projects:///')).toStrictEqual(
      listing(false, 'projects://'),
    );
  });

  it('accepts the explicit archived listing', () => {
    expect(parseProjectLocator('projects://archived')).toStrictEqual(
      listing(true, 'projects://archived'),
    );
    expect(parseProjectLocator('PROJECTS://archived')).toStrictEqual(
      listing(true, 'projects://archived'),
    );
  });

  it('canonicalizes the scheme and UUID of one Project', () => {
    expect(parseProjectLocator(CANONICAL)).toStrictEqual(detail(PROJECT_ID));
    expect(
      parseProjectLocator(`PROJECTS://${PROJECT_ID.toUpperCase()}`),
    ).toStrictEqual(detail(PROJECT_ID));
    expect(
      parseProjectLocator(`Projects://${PROJECT_ID.toUpperCase()}`),
    ).toStrictEqual(detail(PROJECT_ID));
  });

  it('keeps distinct UUIDs as distinct resources', () => {
    expect(parseProjectLocator(`projects://${OTHER_PROJECT_ID}`)).toStrictEqual(
      detail(OTHER_PROJECT_ID),
    );
    expect(
      parseProjectLocator(`projects://${OTHER_PROJECT_ID.toUpperCase()}`),
    ).toStrictEqual(detail(OTHER_PROJECT_ID));
    expect(detail(OTHER_PROJECT_ID).canonical).not.toBe(CANONICAL);
  });

  it('splits a native selector off the canonical resource', () => {
    expect(parseProjectLocator('projects://:raw')).toStrictEqual(
      listing(false, 'projects://', 'raw'),
    );
    expect(parseProjectLocator('projects:///:5-9')).toStrictEqual(
      listing(false, 'projects://', '5-9'),
    );
    expect(
      parseProjectLocator('projects://archived:outline:3-9'),
    ).toStrictEqual(listing(true, 'projects://archived', 'outline:3-9'));
    expect(parseProjectLocator(`${CANONICAL}:raw`)).toStrictEqual(
      detail(PROJECT_ID, 'raw'),
    );
    expect(parseProjectLocator(`${CANONICAL}:5-9:raw`)).toStrictEqual(
      detail(PROJECT_ID, 'raw:5-9'),
    );
    expect(parseProjectLocator(`${CANONICAL}:10-20,30-40`)).toStrictEqual(
      detail(PROJECT_ID, '10-20,30-40'),
    );
  });

  it('keeps the canonical identity selector-free for every spelling', () => {
    const variants = [
      `PROJECTS://${PROJECT_ID.toUpperCase()}:raw`,
      `${CANONICAL}:raw:1-10`,
      `${CANONICAL}:outline`,
      `${CANONICAL}:1-5:raw`,
    ];

    for (const variant of variants) {
      expect(parseProjectLocator(variant)?.canonical).toBe(CANONICAL);
    }
  });

  it('returns a suffix outside the native grammar for the reader to refuse', () => {
    // The Project grammar decides the resource only. A suffix it splits off
    // stays on the locator so the native text reader reports invalid_selector
    // rather than this parser reporting a wrong resource path.
    expect(parseProjectLocator(`${CANONICAL}:nonsense`)).toStrictEqual(
      detail(PROJECT_ID, 'nonsense'),
    );
    expect(parseProjectLocator(`${CANONICAL}:`)).toStrictEqual(
      detail(PROJECT_ID, ''),
    );
    expect(parseProjectLocator(`${CANONICAL}:outline:1,3`)).toStrictEqual(
      detail(PROJECT_ID, 'outline:1,3'),
    );
    expect(parseProjectLocator('projects://:nonsense')).toStrictEqual(
      listing(false, 'projects://', 'nonsense'),
    );
  });

  it.each([
    'projects://name',
    'projects://archived/',
    'projects://archived/now',
    'projects://Archived',
    'projects://ARCHIVED',
    'projects:///archived',
    `projects:///${PROJECT_ID}`,
    `projects://${PROJECT_ID}/`,
    `projects://${PROJECT_ID}/other`,
    `projects://${PROJECT_ID}//`,
    `projects://${PROJECT_ID}?archived`,
    `projects://${PROJECT_ID}#top`,
    `projects://${PROJECT_ID}%2F`,
    `projects://%61rchived`,
    `projects://${PROJECT_ID}:raw?x`,
    `projects://${PROJECT_ID}:raw#frag`,
    `projects://${PROJECT_ID}:raw:1%2D5`,
    'projects://?',
    'projects://#',
    'projects:///?query',
    'projects:///#fragment',
    'projects:/',
    `projects:${PROJECT_ID}`,
    `project://${PROJECT_ID}`,
    `projects://${PROJECT_ID}0`,
    `projects://${PROJECT_ID.slice(0, -1)}`,
    `projects://{${PROJECT_ID}}`,
    `projects://urn:uuid:${PROJECT_ID}`,
    'projects://0190f5e27c1a7b3e9d4f2a6b8c0d1e2f',
    'projects://0190f5e2-7c1a-7b3e-9d4f-2a6b8c0d1e2g',
    'projects://0190f5e2-7c1a-7b3e-9d4f2a6b-8c0d1e2f',
    'projects://0190f5e2_7c1a_7b3e_9d4f_2a6b8c0d1e2f',
  ])('refuses the malformed locator %s', (submitted) => {
    expect(parseProjectLocator(submitted)).toBeUndefined();
  });

  it.each([
    'https://example.test/projects',
    'job://bash-4',
    'skill://pdf',
    '/projects',
    '',
  ])('leaves the unrelated locator %s alone', (submitted) => {
    expect(parseProjectLocator(submitted)).toBeUndefined();
  });
});
