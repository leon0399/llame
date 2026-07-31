import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { InstanceConfigError } from './instance-config.error';
import {
  createModelPromptLoader,
  DEFAULT_CHAT_SYSTEM_PROMPT_PATH,
  resolveDefaultChatSystemPromptPath,
  type PromptFileAccess,
} from './prompt-loader';

let tmpDir: string;
let configPath: string;
let defaultPromptPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'llame-prompt-loader-'));
  configPath = path.join(tmpDir, 'config', 'llame.config.json');
  defaultPromptPath = path.join(tmpDir, 'packaged', 'chat-default.md');
  mkdirSync(path.dirname(configPath), { recursive: true });
  mkdirSync(path.dirname(defaultPromptPath), { recursive: true });
  writeFileSync(defaultPromptPath, 'Default for {{model.id}}');
});

function loader(access?: PromptFileAccess) {
  return createModelPromptLoader({
    configPath,
    defaultPromptPath,
    ...(access ? { access } : {}),
  });
}

describe('model prompt file loading', () => {
  it('reads each distinct file once, then renders it separately per model', () => {
    const contents = new Map([
      [defaultPromptPath, 'Default for {{model.id}}'],
      [path.join(path.dirname(configPath), 'shared.md'), 'Hello {{model.id}}'],
    ]);
    const readFile = jest.fn((file: string) => contents.get(file) ?? '');
    const access: PromptFileAccess = {
      isFile: jest.fn((file) => contents.has(file)),
      readFile,
    };
    const prompts = loader(access);

    expect(
      prompts.resolve({ id: 'first', systemPromptFile: 'shared.md' }),
    ).toMatchObject({ systemPrompt: 'Hello first' });
    expect(
      prompts.resolve({ id: 'second', systemPromptFile: 'shared.md' }),
    ).toMatchObject({ systemPrompt: 'Hello second' });
    prompts.validateProjectDefault();
    prompts.validateProjectDefault();

    expect(readFile).toHaveBeenCalledTimes(2);
  });

  it('treats systemPromptFile as a literal path rather than secret interpolation', () => {
    expect(() =>
      loader().resolve({
        id: 'model-id',
        systemPromptFile: '{path:/run/secrets/prompt}',
      }),
    ).toThrow(/models\[model-id\]\.systemPromptFile/);
  });

  it('fails an unreadable override without printing prompt content or paths', () => {
    const access: PromptFileAccess = {
      isFile: () => true,
      readFile: () => {
        throw Object.assign(new Error('sensitive-host-path'), {
          code: 'EACCES',
        });
      },
    };

    expect(() =>
      loader(access).resolve({ id: 'private-model', systemPromptFile: 'x.md' }),
    ).toThrow(InstanceConfigError);
    expect(() =>
      loader(access).resolve({ id: 'private-model', systemPromptFile: 'x.md' }),
    ).toThrow(/models\[private-model\]\.systemPromptFile/);
    expect(() =>
      loader(access).resolve({ id: 'private-model', systemPromptFile: 'x.md' }),
    ).not.toThrow(/sensitive-host-path|x\.md/);
  });

  it.each([
    ['missing', false, () => 'unused'],
    ['empty', true, () => ' \r\n\t'],
  ] as const)(
    'fails a %s packaged default when a model needs it',
    (_kind, isFile, readFile) => {
      const prompts = loader({ isFile: () => isFile, readFile });

      expect(() => prompts.resolve({ id: 'model-id' })).toThrow(
        InstanceConfigError,
      );
      expect(() => prompts.resolve({ id: 'model-id' })).toThrow(
        /models\[model-id\]\.systemPromptFile/,
      );
    },
  );

  it('validates unsupported variables in the packaged default even when no model selects it', () => {
    writeFileSync(
      defaultPromptPath,
      'private prompt sentinel {{model.providerModelId}}',
    );

    expect(() => loader().validateProjectDefault()).toThrow(
      'project default system prompt asset: unsupported prompt construct "{{model.providerModelId}}"',
    );
    expect(() => loader().validateProjectDefault()).not.toThrow(
      /private prompt sentinel/,
    );
  });
});

describe('model prompt rendering', () => {
  it('renders the supported variables and the literal-expression escape in one pass', () => {
    writeFileSync(
      defaultPromptPath,
      'id {{model.id}} name {{model.name}} literal \\{{model.name}}',
    );

    expect(loader().resolve({ id: 'model-id', name: 'Model Name' })).toEqual({
      systemPrompt: 'id model-id name Model Name literal {{model.name}}',
      systemPromptSource: 'project_default',
    });
  });

  it('does not re-evaluate a rendered value as a template', () => {
    writeFileSync(defaultPromptPath, 'name {{model.name}}');

    expect(
      loader().resolve({ id: 'model-id', name: '{{model.id}}' }).systemPrompt,
    ).toBe('name {{model.id}}');
  });

  it('renders an absent model.name as empty instead of failing startup', () => {
    // The pre-cutover grammar failed here. That rule only made sense while
    // absence was inexpressible; with conditionals it would reject the very
    // idiom they exist for (asserted below).
    writeFileSync(defaultPromptPath, 'name [{{model.name}}]');

    expect(loader().resolve({ id: 'nameless' }).systemPrompt).toBe('name []');
  });

  it('omits a conditional block when its value is absent, and keeps it when present', () => {
    writeFileSync(
      defaultPromptPath,
      'start\n{{#if model.name}}Name: {{model.name}}\n{{/if}}end',
    );

    expect(loader().resolve({ id: 'nameless' }).systemPrompt).toBe(
      'start\nend',
    );
    expect(
      loader().resolve({ id: 'named', name: 'Model Name' }).systemPrompt,
    ).toBe('start\nName: Model Name\nend');
  });

  it('treats a whitespace-only value as absent so conditionals stay correct', () => {
    writeFileSync(defaultPromptPath, 'x{{#if model.name}}NAME{{/if}}y');

    expect(loader().resolve({ id: 'blank', name: '   ' }).systemPrompt).toBe(
      'xy',
    );
  });

  it('supports unless and whitespace control', () => {
    writeFileSync(
      defaultPromptPath,
      'a{{#unless model.name}}NONE{{/unless}}b {{~#if model.id}}ID{{/if}}',
    );

    expect(loader().resolve({ id: 'model-id' }).systemPrompt).toBe('aNONEbID');
  });

  it('permits a comment and keeps it out of the rendered prompt', () => {
    writeFileSync(defaultPromptPath, 'before {{! private note }}after');

    expect(loader().resolve({ id: 'model-id' }).systemPrompt).toBe(
      'before after',
    );
  });

  it('escapes only markup characters, leaving prose punctuation intact', () => {
    writeFileSync(defaultPromptPath, 'name <b>{{model.name}}</b>');

    expect(
      loader().resolve({ id: 'model-id', name: `don't <x> & "q" = y \` z` })
        .systemPrompt,
    ).toBe('name <b>don\'t &lt;x&gt; &amp; "q" = y ` z</b>');
  });

  it('fails a template whose only content is expressions and whitespace', () => {
    writeFileSync(defaultPromptPath, ' {{model.id}} ');

    expect(() => loader().resolve({ id: 'model-id' })).toThrow(
      'prompt file is empty',
    );
  });

  it.each([
    ['{{model}}', 'unsupported prompt construct "{{model}}"'],
    [
      '{{model.providerModelId}}',
      'unsupported prompt construct "{{model.providerModelId}}"',
    ],
    [
      '{{config.providers}}',
      'unsupported prompt construct "{{config.providers}}"',
    ],
    ['{{env.API_KEY}}', 'unsupported prompt construct "{{env.API_KEY}}"'],
    ['{{{model.id}}}', 'unescaped output'],
    ['{{> shared}}', 'PartialStatement'],
    ['{{#> shared}}x{{/shared}}', 'PartialBlockStatement'],
    ['{{#*inline "x"}}y{{/inline}}{{> x}}', 'DecoratorBlock'],
    ['{{fmt model.id}}', 'helper invocation'],
    ['{{#each model.id}}x{{/each}}', 'each'],
    ['${model.id}', 'legacy'],
    ['$${model.name}', 'legacy'],
  ])('rejects %s without printing the prompt', (expression, expected) => {
    writeFileSync(defaultPromptPath, `private prompt sentinel ${expression}`);

    expect(() => loader().resolve({ id: 'model-id', name: 'name' })).toThrow(
      expected,
    );
    expect(() =>
      loader().resolve({ id: 'model-id', name: 'name' }),
    ).not.toThrow(/private prompt sentinel/);
  });
});

describe('project-default prompt packaging contract', () => {
  it('uses the same relative layout in source/Jest and compiled dist', () => {
    const sourceModuleDir = __dirname;
    const apiRoot = path.resolve(sourceModuleDir, '../..');

    expect(DEFAULT_CHAT_SYSTEM_PROMPT_PATH).toBe(
      path.join(apiRoot, 'src/prompts/chat-default.md'),
    );
    expect(
      resolveDefaultChatSystemPromptPath(
        path.join(apiRoot, 'dist/instance-config'),
      ),
    ).toBe(path.join(apiRoot, 'dist/prompts/chat-default.md'));
  });

  it('declares the prompt asset in Nest packaging and can load the source asset', () => {
    const apiRoot = path.resolve(__dirname, '../..');
    const nestConfig = JSON.parse(
      readFileSync(path.join(apiRoot, 'nest-cli.json'), 'utf8'),
    ) as { compilerOptions: { assets: string[] } };

    expect(nestConfig.compilerOptions.assets).toContain('prompts/*.md');
    expect(
      createModelPromptLoader({ configPath }).resolve({ id: 'model-id' })
        .systemPrompt,
    ).toMatch(/\S/);
  });
});
