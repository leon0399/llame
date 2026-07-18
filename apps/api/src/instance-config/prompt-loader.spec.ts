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
  writeFileSync(defaultPromptPath, 'Default for ${model.id}');
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
      [defaultPromptPath, 'Default for ${model.id}'],
      [path.join(path.dirname(configPath), 'shared.md'), 'Hello ${model.id}'],
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
      'private prompt sentinel ${model.providerModelId}',
    );

    expect(() => loader().validateProjectDefault()).toThrow(
      /project default system prompt asset.*\$\{model\.providerModelId\}/,
    );
    expect(() => loader().validateProjectDefault()).not.toThrow(
      /private prompt sentinel/,
    );
  });
});

describe('model prompt rendering', () => {
  it('renders the exact supported variables and name escape in one pass', () => {
    writeFileSync(
      defaultPromptPath,
      '${model.id}|${model.name}|$${model.name}',
    );

    expect(loader().resolve({ id: 'model-id', name: 'Model Name' })).toEqual({
      systemPrompt: 'model-id|Model Name|${model.name}',
      systemPromptSource: 'project_default',
    });
  });

  it('does not recursively interpolate a replacement value', () => {
    writeFileSync(defaultPromptPath, '${model.name}');

    expect(
      loader().resolve({ id: 'model-id', name: '${model.id}' }).systemPrompt,
    ).toBe('${model.id}');
  });

  it('fails when model.name is referenced but absent', () => {
    writeFileSync(defaultPromptPath, '${model.name}');

    expect(() => loader().resolve({ id: 'nameless' })).toThrow(
      /models\[nameless\].*\$\{model\.name\}/,
    );
  });

  it.each([
    '${model}',
    '${model.providerModelId}',
    '${config.providers}',
    '${env.API_KEY}',
    '$${model.id}',
  ])(
    'rejects unsupported expression %s without printing the prompt',
    (expression) => {
      writeFileSync(defaultPromptPath, `private prompt sentinel ${expression}`);

      expect(() => loader().resolve({ id: 'model-id', name: 'name' })).toThrow(
        new RegExp(expression.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      );
      expect(() =>
        loader().resolve({ id: 'model-id', name: 'name' }),
      ).not.toThrow(/private prompt sentinel/);
    },
  );
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
