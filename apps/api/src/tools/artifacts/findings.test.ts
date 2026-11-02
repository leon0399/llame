import { applySelectorSuffix } from '@workspace/native-file-tools';
import { type UnknownRecord } from '@workspace/runtime-safety';
import { describe, expect, it } from 'vitest';

import { compileToolPermissionMap } from '../permissions/compile-permissions';
import { type PermissionMode } from '../permissions/permission-mode';
import {
  type CompiledPolicy,
  type ToolPermissionMap,
} from '../permissions/types';
import { type ToolContext } from '../types';
import {
  artifactFindings,
  parseArtifactFindings,
  type ArtifactFindings,
  type FindingPart,
  withholdFindings,
} from './findings';

const GREP_LOCATOR = '/home/u/secrets/a.ts';
const ANSWER_URL = 'https://example.com/report';
const OTHER_URL = 'https://docs.example.test/guide';

function policy(map: ToolPermissionMap): CompiledPolicy {
  return compileToolPermissionMap(map, 'test-policy');
}

/** A full Run context; the re-check never reaches `tenantDb`. */
function contextOf(
  compiled: CompiledPolicy | undefined,
  mode?: PermissionMode,
): ToolContext {
  return {
    userId: 'owner',
    chatId: 'chat',
    permissionPolicy: compiled,
    ...(mode !== undefined && { permissionMode: mode }),
    tenantDb: {
      runAs: () => Promise.reject(new Error('no database in this test')),
    },
  };
}

/** A context that counts how often permission evaluation reads the policy. */
type TrackedContext = {
  readonly context: ToolContext;
  readonly reads: () => number;
};

function trackedContext(
  compiled: CompiledPolicy,
  mode?: PermissionMode,
): TrackedContext {
  let reads = 0;
  const context: ToolContext = {
    ...contextOf(compiled, mode),
    get permissionPolicy() {
      reads += 1;
      return compiled;
    },
  };
  return { context, reads: () => reads };
}

const MARKDOWN = 'text/markdown';
const PLAIN = 'text/plain';

/** A stored part's finding value: one the writer built, or a malformed shape. */
type FindingsFixture = ArtifactFindings | UnknownRecord | null | undefined;

function withheld(
  context: ToolContext,
  text: string,
  findings: FindingsFixture,
  options: { selector?: string; contentType?: string } = {},
): string {
  const target = applySelectorSuffix('artifact://grep-1', options.selector);
  const part: FindingPart = {
    findings,
    contentType: options.contentType ?? MARKDOWN,
  };
  const ended = text.endsWith('\n');
  return withholdFindings(context, part, text, {
    ...target,
    lineCount: ended ? text.split('\n').length - 1 : text.split('\n').length,
  });
}

const GREP_TEXT = `## ${GREP_LOCATOR}\n1: token\n${'body\n'.repeat(6)}`;
const PLAIN_TEXT = `${'line\n'.repeat(9)}line\n`;

const grepFinding = (start: number, end: number): ArtifactFindings =>
  artifactFindings([
    { locators: [GREP_LOCATOR], rule: 'allow_only', start, end },
  ]);

const allowNothing = policy({
  read: { allow: [{ field: 'path', regex: '^/repo/' }] },
});

describe('parseArtifactFindings', () => {
  it('round-trips a document the writer built', () => {
    const document = artifactFindings([
      { locators: [GREP_LOCATOR], rule: 'allow_only', start: 1, end: 2 },
    ]);

    expect(parseArtifactFindings(document)).toEqual(document);
  });

  it('accepts a large finding list, because the byte bound is the limit', () => {
    const findings = Array.from({ length: 5000 }, (_value, index) => ({
      locators: [`/repo/file-${index}.ts`],
      rule: 'allow_only' as const,
      start: index * 2 + 1,
      end: index * 2 + 2,
    }));

    expect(parseArtifactFindings(artifactFindings(findings))).toEqual(
      artifactFindings(findings),
    );
  });

  it.each([
    ['another version', { version: 2, findings: [] }],
    ['a missing finding list', { version: 1 }],
    [
      'an unknown rule',
      {
        version: 1,
        findings: [{ locators: ['a'], rule: 'allow', start: 1, end: 1 }],
      },
    ],
    [
      'a fractional start',
      {
        version: 1,
        findings: [{ locators: ['a'], rule: 'allow_only', start: 1.5, end: 2 }],
      },
    ],
    [
      'a fractional end',
      {
        version: 1,
        findings: [{ locators: ['a'], rule: 'allow_only', start: 1, end: 1.5 }],
      },
    ],
    [
      'a reversed range',
      {
        version: 1,
        findings: [{ locators: ['a'], rule: 'allow_only', start: 2, end: 1 }],
      },
    ],
    [
      'a zero line',
      {
        version: 1,
        findings: [{ locators: ['a'], rule: 'allow_only', start: 0, end: 1 }],
      },
    ],
    [
      'no locator',
      {
        version: 1,
        findings: [{ locators: [], rule: 'allow_only', start: 1, end: 1 }],
      },
    ],
    [
      'a non-string locator',
      {
        version: 1,
        findings: [{ locators: [7], rule: 'allow_only', start: 1, end: 1 }],
      },
    ],
    [
      'an empty locator',
      {
        version: 1,
        findings: [{ locators: [''], rule: 'allow_only', start: 1, end: 1 }],
      },
    ],
    [
      'a non-array locator list',
      {
        version: 1,
        findings: [{ locators: 'a', rule: 'allow_only', start: 1, end: 1 }],
      },
    ],
    ['a non-record finding', { version: 1, findings: ['a'] }],
  ])('refuses %s', (_label, value) => {
    expect(parseArtifactFindings(value)).toBeUndefined();
  });
});

describe('withholdFindings', () => {
  it('withholds a grep finding the current read group no longer admits', () => {
    const text = `## ${GREP_LOCATOR}\n1: token\nbody\n`;

    expect(withheld(contextOf(allowNothing), text, grepFinding(1, 2))).toBe(
      '[withheld]\n[withheld]\nbody\n',
    );
  });

  it('keeps a grep finding the current read group admits', () => {
    const context = contextOf(
      policy({
        read: { allow: [{ field: 'path', regex: '^/home/u/secrets/' }] },
      }),
    );
    const text = `## ${GREP_LOCATOR}\n1: token\nbody\n`;

    expect(withheld(context, text, grepFinding(1, 2))).toBe(text);
  });

  it('keeps the text when the part records no finding', () => {
    expect(
      withheld(contextOf(undefined), GREP_TEXT, null, { contentType: PLAIN }),
    ).toBe(GREP_TEXT);
    expect(
      withheld(contextOf(undefined), GREP_TEXT, undefined, {
        contentType: PLAIN,
      }),
    ).toBe(GREP_TEXT);
  });

  it('withholds everything when the record cannot be parsed', () => {
    const text = `## ${GREP_LOCATOR}\n1: token\n`;

    expect(withheld(contextOf(undefined), text, { version: 99 })).toBe(
      '[withheld]\n[withheld]\n',
    );
  });

  it('withholds the line just after a single-range window, as the reader serves it', () => {
    // Line 10 starts the refused finding; a non-raw `1-9` read serves it as
    // its trailing context line.
    expect(
      withheld(contextOf(allowNothing), PLAIN_TEXT, grepFinding(10, 10), {
        selector: '1-9',
        contentType: PLAIN,
      }),
    ).toContain('[withheld]');
  });

  it('withholds a finding that starts on the last served line', () => {
    const text = `${'line\n'.repeat(4)}secret\n`;
    // A `1-3` read serves lines 1 to 4, context included.
    expect(
      withheld(contextOf(allowNothing), text, grepFinding(4, 5), {
        selector: '1-3',
        contentType: PLAIN,
      }),
    ).toBe('line\nline\nline\n[withheld]\n[withheld]\n');

    // A `1-2` read serves through line 3, so line 4 is not evaluated.
    expect(
      withheld(contextOf(allowNothing), text, grepFinding(4, 5), {
        selector: '1-2',
        contentType: PLAIN,
      }),
    ).toBe(text);
  });

  it('withholds the line just before a single-range window', () => {
    const text = `secret\n${'line\n'.repeat(9)}`;
    // The refused finding ends on line 10; a `11-12` read serves it as its
    // leading context line.
    expect(
      withheld(contextOf(allowNothing), text, grepFinding(10, 10), {
        selector: '11-12',
        contentType: PLAIN,
      }),
    ).toContain('[withheld]');
  });

  it('uses the grown comma windows the reader reads', () => {
    const text = `${'line\n'.repeat(9)}line\n`;
    const document = artifactFindings([
      { locators: [GREP_LOCATOR], rule: 'allow_only', start: 4, end: 4 },
      { locators: [GREP_LOCATOR], rule: 'allow_only', start: 8, end: 8 },
    ]);

    // `1,3` reads around lines 1 and 3; the grown windows reach line 4 only.
    expect(
      withheld(contextOf(allowNothing), text, document, {
        selector: '1,3',
        contentType: PLAIN,
      }),
    ).toBe(`${'line\n'.repeat(3)}[withheld]\n${'line\n'.repeat(6)}`);
  });

  it('withholds a web result after a reject clause matches it', () => {
    const context = contextOf(
      policy({ read: { reject: [{ field: 'path', regex: 'example\\.com' }] } }),
    );
    const document = artifactFindings([
      { locators: [ANSWER_URL], rule: 'reject_only', start: 1, end: 1 },
    ]);
    const text = `## 1. Report\n${ANSWER_URL}\n> snippet\n`;

    expect(withheld(context, text, document)).toBe(
      '[withheld]\nhttps://example.com/report\n> snippet\n',
    );
  });

  it('withholds a web result the window reaches only as context', () => {
    const context = contextOf(
      policy({ read: { reject: [{ field: 'path', regex: 'example\\.com' }] } }),
    );
    const document = artifactFindings([
      { locators: [OTHER_URL], rule: 'reject_only', start: 1, end: 3 },
      { locators: [ANSWER_URL], rule: 'reject_only', start: 4, end: 6 },
    ]);
    const text = `## 1. Guide\n${OTHER_URL}\n> ok\n## 2. Report\n${ANSWER_URL}\n> secret\n`;

    // A `1-3` read serves line 4 as trailing context.
    expect(withheld(context, text, document, { selector: '1-3' })).toBe(
      `## 1. Guide\n${OTHER_URL}\n> ok\n[withheld]\n[withheld]\n[withheld]\n`,
    );
  });

  it('keeps a web result without an allow and without a matching reject', () => {
    const context = contextOf(
      policy({ read: { allow: [{ field: 'path', regex: '^/home/' }] } }),
    );
    const document = artifactFindings([
      { locators: [OTHER_URL], rule: 'reject_only', start: 1, end: 1 },
    ]);
    const text = `## 1. Guide\n${OTHER_URL}\n`;

    expect(withheld(context, text, document)).toBe(text);
  });

  it('keeps a web result on a whole-tool reject, which removed nothing', () => {
    const context = contextOf(policy({ read: { reject: true } }));
    const document = artifactFindings([
      { locators: [OTHER_URL], rule: 'reject_only', start: 1, end: 1 },
    ]);
    const text = `## 1. Guide\n${OTHER_URL}\n`;

    expect(withheld(context, text, document)).toBe(text);
  });

  it('withholds a whole answer when one of its citations is refused', () => {
    const context = contextOf(
      policy({ read: { reject: [{ field: 'path', regex: 'example\\.com' }] } }),
    );
    const document = artifactFindings([
      {
        locators: [OTHER_URL, ANSWER_URL],
        rule: 'reject_only',
        start: 1,
        end: 2,
      },
    ]);
    const text = `## Answer\n${OTHER_URL} ${ANSWER_URL}\n`;

    expect(withheld(context, text, document)).toBe('[withheld]\n[withheld]\n');
  });

  it('fails closed on every rule when no policy exists', () => {
    expect(
      withheld(contextOf(undefined), PLAIN_TEXT, grepFinding(1, 1), {
        contentType: PLAIN,
      }),
    ).toContain('[withheld]');
    const web = artifactFindings([
      { locators: [OTHER_URL], rule: 'reject_only', start: 1, end: 1 },
    ]);
    expect(
      withheld(contextOf(undefined), `## Guide\n${OTHER_URL}\n`, web),
    ).toBe('[withheld]\nhttps://docs.example.test/guide\n');
  });

  it('sees every finding on a bypassed attempt and reads no policy', () => {
    const tracked = trackedContext(
      policy({ read: { reject: [{ field: 'path', regex: '^/home/' }] } }),
      'bypass',
    );

    expect(withheld(tracked.context, GREP_TEXT, grepFinding(1, 2))).toBe(
      GREP_TEXT,
    );
    expect(tracked.reads()).toBe(0);
  });

  it('leaves a bypassed malformed record alone', () => {
    const tracked = trackedContext(policy({ read: {} }), 'bypass');

    expect(withheld(tracked.context, GREP_TEXT, { version: 99 })).toBe(
      GREP_TEXT,
    );
    expect(tracked.reads()).toBe(0);
  });

  it('evaluates each distinct rule and locator once per read', () => {
    const tracked = trackedContext(allowNothing);
    const document = artifactFindings([
      { locators: [GREP_LOCATOR], rule: 'allow_only', start: 1, end: 1 },
      { locators: [GREP_LOCATOR], rule: 'allow_only', start: 2, end: 2 },
    ]);

    withheld(tracked.context, PLAIN_TEXT, document, { contentType: PLAIN });
    // One evaluation reads the policy twice (the guard and the evaluator);
    // a second evaluation of the same key would double it.
    expect(tracked.reads()).toBe(2);
  });

  it('serves a Markdown section heading with its body', () => {
    const context = contextOf(allowNothing);
    const text = `## a\nbody a\n## ${GREP_LOCATOR}\n1: token\n`;

    expect(withheld(context, text, grepFinding(3, 4), { selector: '4' })).toBe(
      '## a\nbody a\n[withheld]\n[withheld]\n',
    );
  });

  it('does not reach ancestors on a raw read', () => {
    const context = contextOf(allowNothing);
    const text = `## ${GREP_LOCATOR}\n1: token\nbody\n`;

    expect(
      withheld(context, text, grepFinding(1, 2), { selector: '3:raw' }),
    ).toBe(text);
  });

  it('leaves a bash part with no finding record alone', () => {
    const context = contextOf(policy({ read: { reject: true } }));

    expect(
      withheld(context, 'stdout line\n', null, { contentType: PLAIN }),
    ).toBe('stdout line\n');
  });

  it('keeps a withheld last line without adding a terminator', () => {
    expect(
      withheld(contextOf(allowNothing), 'a\nb', grepFinding(2, 2), {
        contentType: PLAIN,
      }),
    ).toBe('a\n[withheld]');
  });
});
