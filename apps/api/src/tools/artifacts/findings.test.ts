import { applySelectorSuffix } from '@workspace/native-file-tools';
import { type UnknownRecord } from '@workspace/runtime-safety';
import { describe, expect, it, vi } from 'vitest';

import { compileToolPermissionMap } from '../permissions/compile-permissions';
import { type PermissionMode } from '../permissions/permission-mode';
import {
  type CompiledPolicy,
  type ToolPermissionMap,
} from '../permissions/types';
import {
  artifactFindings,
  parseArtifactFindings,
  type ArtifactFindings,
  type FindingContext,
  withholdFindings,
} from './findings';

const GREP_LOCATOR = '/home/u/secrets/a.ts';
const ANSWER_URL = 'https://example.com/report';
const OTHER_URL = 'https://docs.example.test/guide';

function policy(map: ToolPermissionMap): CompiledPolicy {
  return compileToolPermissionMap(map, 'test-policy');
}

function contextOf(
  compiled: CompiledPolicy | undefined,
  mode?: PermissionMode,
): FindingContext {
  return {
    permissionPolicy: compiled,
    ...(mode !== undefined && { permissionMode: mode }),
  };
}

const MARKDOWN = 'text/markdown';

/** A stored part's finding value: one the writer built, or a malformed shape. */
type FindingsFixture = ArtifactFindings | UnknownRecord | null;

function withheld(
  context: FindingContext,
  text: string,
  findings: FindingsFixture,
  options: { selector?: string; contentType?: string } = {},
): string {
  const target = applySelectorSuffix('artifact://grep-1', options.selector);
  const resolved = { ...target, lineCount: text.split('\n').length - 1 };
  return withholdFindings(
    context,
    { findings, contentType: options.contentType ?? MARKDOWN },
    text,
    resolved,
  );
}

describe('parseArtifactFindings', () => {
  it('round-trips a document the writer built', () => {
    const document = artifactFindings([
      {
        locators: [GREP_LOCATOR],
        rule: 'allow_only',
        start: 1,
        end: 2,
      },
    ]);

    expect(parseArtifactFindings(document)).toEqual(document);
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
  ])('refuses %s', (_label, value) => {
    expect(parseArtifactFindings(value)).toBeUndefined();
  });
});

describe('withholdFindings', () => {
  const grep = (locators: Array<string> = [GREP_LOCATOR]) =>
    artifactFindings([{ locators, rule: 'allow_only', start: 1, end: 2 }]);

  it('withholds a grep finding the current read group no longer admits', () => {
    const context = contextOf(
      policy({
        read: { allow: [{ field: 'path', regex: '^/home/u/public/' }] },
      }),
    );
    const text = `## ${GREP_LOCATOR}\n1: token\nbody\n`;

    expect(withheld(context, text, grep())).toBe(
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

    expect(withheld(context, text, grep())).toBe(text);
  });

  it('keeps the text when the part records no finding', () => {
    const text = `## ${GREP_LOCATOR}\n1: token\n`;
    // No policy at all: a consulted allow-only rule would withhold.
    expect(withheld(contextOf(undefined), text, null)).toBe(text);
  });

  it('withholds everything when the record cannot be parsed', () => {
    const text = `## ${GREP_LOCATOR}\n1: token\n`;

    expect(withheld(contextOf(undefined), text, { version: 99 })).toBe(
      '[withheld]\n[withheld]\n',
    );
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

  it('sees every finding on a bypassed attempt', () => {
    const context = contextOf(
      policy({ read: { reject: [{ field: 'path', regex: '^/home/' }] } }),
      'bypass',
    );
    const text = `## ${GREP_LOCATOR}\n1: token\n`;

    expect(withheld(context, text, grep())).toBe(text);
  });

  it('records no finding decision', () => {
    const record = vi.fn();
    const context = {
      ...contextOf(policy({ read: {} })),
      onDerivedDecision: record,
    };
    const text = `## ${GREP_LOCATOR}\n1: token\n`;

    expect(withheld(context, text, grep())).toBe('[withheld]\n[withheld]\n');
    expect(record).not.toHaveBeenCalled();
  });

  it('withholds only the findings the served window touches', () => {
    const context = contextOf(policy({ read: {} }));
    const document = artifactFindings([
      { locators: [GREP_LOCATOR], rule: 'allow_only', start: 1, end: 2 },
      {
        locators: ['/home/u/secrets/b.ts'],
        rule: 'allow_only',
        start: 4,
        end: 5,
      },
    ]);
    const text = `## ${GREP_LOCATOR}\n1: a\nbody\n## b\n1: b\n`;

    // Lines 4 to 5 are served: only the second finding is withheld. Plain
    // text has no ancestor headings to reach above the window.
    expect(
      withheld(context, text, document, {
        selector: '4-5',
        contentType: 'text/plain',
      }),
    ).toBe(`## ${GREP_LOCATOR}\n1: a\nbody\n[withheld]\n[withheld]\n`);
  });

  it('withholds a finding a Markdown ancestor line serves', () => {
    const context = contextOf(policy({ read: {} }));
    const document = artifactFindings([
      { locators: [GREP_LOCATOR], rule: 'allow_only', start: 1, end: 2 },
    ]);
    const text = `## ${GREP_LOCATOR}\n1: a\nbody\n`;

    // A Markdown read from line 4 pulls in its ancestor heading on line 1.
    expect(withheld(context, text, document, { selector: '4' })).toContain(
      '[withheld]\n',
    );
  });

  it('does not reach ancestors on a raw read', () => {
    const context = contextOf(policy({ read: {} }));
    const document = artifactFindings([
      { locators: [GREP_LOCATOR], rule: 'allow_only', start: 1, end: 2 },
    ]);
    const text = `## ${GREP_LOCATOR}\n1: a\nbody\n`;

    expect(
      withheld(context, text, document, { selector: '4:raw' }),
    ).not.toContain('[withheld]');
  });

  it('leaves a bash part with no finding record alone', () => {
    const text = 'stdout line\n';
    const context = contextOf(
      policy({ read: { reject: [{ field: 'path', regex: '.' }] } }),
    );

    expect(withheld(context, text, null, { contentType: 'text/plain' })).toBe(
      text,
    );
  });
});
