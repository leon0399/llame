import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { compilePromptTemplate, loadPackagedTemplate } from './template-engine';

/** Characters handlebars' default escaping turns into entities, and what it
 *  turns them into — the operator regime's bytes, pinned literally. */
const RAW_VALUE = `<&>"'`;
const ESCAPED_VALUE = '&lt;&amp;&gt;&quot;&#x27;';

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'llame-template-engine-'));
  mkdirSync(path.join(directory, 'prompts'), { recursive: true });
});

function writeTemplate(name: string, source: string): void {
  writeFileSync(path.join(directory, 'prompts', `${name}.md`), source);
}

describe('loadPackagedTemplate', () => {
  it('renders a value raw that the operator regime would escape', () => {
    writeTemplate('raw', 'value={{value}}');
    const render = loadPackagedTemplate<{ value: string }>(directory, 'raw');

    expect(render({ value: RAW_VALUE })).toBe(`value=${RAW_VALUE}`);
  });

  it('keeps the two escape regimes apart for one source, whichever compiles first', () => {
    // A source-only compile cache would hand whichever compilation ran first to
    // the other regime, so both orders are exercised: the packaged file loads
    // (and compiles) before the operator source under the first name, and after
    // it under the second. One assertion per combination, because either
    // collision changes only the regime that lost the race.
    const packagedFirstSource = 'packaged-first={{value}}';
    const operatorFirstSource = 'operator-first={{value}}';
    writeTemplate('packaged-first', packagedFirstSource);
    const packagedFirst = loadPackagedTemplate<{ value: string }>(
      directory,
      'packaged-first',
    );
    const operatorFirst = compilePromptTemplate(packagedFirstSource);
    const operatorSecond = compilePromptTemplate(operatorFirstSource);
    writeTemplate('operator-first', operatorFirstSource);
    const packagedSecond = loadPackagedTemplate<{ value: string }>(
      directory,
      'operator-first',
    );

    const packagedFirstValues = packagedFirst({ value: RAW_VALUE });
    const operatorFirstValues = operatorFirst({ value: RAW_VALUE });
    const operatorSecondValues = operatorSecond({ value: RAW_VALUE });
    const packagedSecondValues = packagedSecond({ value: RAW_VALUE });

    expect(packagedFirstValues).toBe(`packaged-first=${RAW_VALUE}`);
    expect(operatorFirstValues).toBe(`packaged-first=${ESCAPED_VALUE}`);
    expect(operatorSecondValues).toBe(`operator-first=${ESCAPED_VALUE}`);
    expect(packagedSecondValues).toBe(`operator-first=${RAW_VALUE}`);
  });

  it('normalizes CRLF and lone CR, and drops whitespace after the last content', () => {
    writeTemplate('crlf', 'line one\r\n\r\nline two\r\nline three   \r\n\r\n');
    writeTemplate('lone-cr', 'a\rb\rc\r');
    writeTemplate('interior', '\n\nkeep\n\n\n\ntrailing  \n\t \n');
    const crlf = loadPackagedTemplate(directory, 'crlf')({});
    const loneCr = loadPackagedTemplate(directory, 'lone-cr')({});
    const interior = loadPackagedTemplate(directory, 'interior')({});

    expect(crlf).toBe('line one\n\nline two\nline three');
    expect(loneCr).toBe('a\nb\nc');
    // Leading and interior blank lines are render-relevant and survive.
    expect(interior).toBe('\n\nkeep\n\n\n\ntrailing');
  });

  it('fails at load time, naming the resolved path, when the template is missing', () => {
    const missingPath = path.join(directory, 'prompts', 'missing.md');

    expect(() => loadPackagedTemplate(directory, 'missing')).toThrow(
      `Packaged prompt template missing: missing (expected ${missingPath})`,
    );
  });

  it('fails at load time, naming the resolved path, when the template is empty', () => {
    const emptyPath = path.join(directory, 'prompts', 'empty.md');
    writeTemplate('empty', '   \r\n\t\n');

    expect(() => loadPackagedTemplate(directory, 'empty')).toThrow(
      `Packaged prompt template empty: ${emptyPath}`,
    );
  });
});
