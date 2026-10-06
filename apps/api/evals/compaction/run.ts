import { readFileSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import {
  buildCompactionRequest,
  normalizeCompactionSummary,
} from '../../src/compaction/compaction';
import { loadInstanceConfig } from '../../src/instance-config/config-loader';
import type { LlameConfig } from '../../src/instance-config/llame-config';
import { loadProductUserAgent } from '../../src/instance-config/product-identity';
import { ModelsService } from '../../src/models/models.service';
import type { ModelClient } from '../../src/models/model-client';
import type { StoredMessage } from '../../src/chats/context-builder';

const FIXTURE_FILES = [
  'user-correction.json',
  'cancelled-task.json',
  'pasted-secret.json',
  'non-english.json',
  'dangling-question.json',
] as const;

const ENGLISH_LANGUAGE_MARKERS = [
  'the',
  'and',
  'this',
  'that',
  'with',
  'from',
  'please',
  'is',
  'are',
  'not',
] as const;

const fixtureMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    text: z.string(),
  })
  .strict();

const fixtureExpectationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('correction'),
      text: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('cancelled'),
      task: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('secret'),
      secret: z.string().min(1),
    })
    .strict(),
  z.object({ kind: z.literal('nonEnglish') }).strict(),
  z
    .object({
      kind: z.literal('danglingQuestion'),
      question: z.string().min(1),
    })
    .strict(),
]);

const fixtureSchema = z
  .object({
    id: z.string().min(1),
    system: z.string().min(1),
    messages: z.array(fixtureMessageSchema),
    expectation: fixtureExpectationSchema,
  })
  .strict();

type Fixture = z.infer<typeof fixtureSchema>;

type Outcome = {
  fixture: string;
  result: 'PASS' | 'FAIL';
  detail: string;
};

type SetupPhase = 'configuration' | 'model' | 'fixture';

class CompactionEvalSetupError extends Error {
  constructor(
    readonly phase: SetupPhase,
    message: string,
  ) {
    super(`compaction eval ${phase} error: ${message}`);
    this.name = 'CompactionEvalSetupError';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const FIXTURE_START_TIME = Date.parse('2026-10-06T00:00:00.000Z');

function synthesizeMessages(fixture: Fixture): Array<StoredMessage> {
  return fixture.messages.map((message, index) => ({
    id: `${fixture.id}-${index + 1}`,
    chatId: fixture.id,
    seq: index + 1,
    role: message.role,
    senderUserId: message.role === 'user' ? 'owner-1' : null,
    parts: [{ type: 'text', text: message.text }],
    attachments: [],
    createdAt: new Date(FIXTURE_START_TIME + index * 1000),
  }));
}

function loadFixture(fileName: string): Fixture {
  const filePath = path.resolve(__dirname, 'fixtures', fileName);
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
    return fixtureSchema.parse(parsed);
  } catch (error: unknown) {
    throw new CompactionEvalSetupError(
      'fixture',
      `${fileName}: ${errorMessage(error)}`,
    );
  }
}

function loadFixtures(): Array<Fixture> {
  const fixtures: Array<Fixture> = [];
  for (const fileName of FIXTURE_FILES) {
    fixtures.push(loadFixture(fileName));
  }
  return fixtures;
}

function createEvalModelClient(): ModelClient {
  const configPath = path.resolve(__dirname, 'eval.config.json');
  const environment = {
    ...process.env,
    LLAME_CONFIG_PATH: configPath,
  };

  let config: LlameConfig;
  try {
    config = loadInstanceConfig(environment);
  } catch (error: unknown) {
    throw new CompactionEvalSetupError('configuration', errorMessage(error));
  }

  const modelId = config.defaults.modelId;
  if (modelId === null) {
    throw new CompactionEvalSetupError(
      'model',
      'eval.config.json does not declare defaults.modelId',
    );
  }

  let productUserAgent: string;
  try {
    productUserAgent = loadProductUserAgent();
  } catch (error: unknown) {
    throw new CompactionEvalSetupError('configuration', errorMessage(error));
  }

  const modelsService = new ModelsService({ config, productUserAgent });
  try {
    return modelsService.createClient(modelId);
  } catch (error: unknown) {
    throw new CompactionEvalSetupError('model', errorMessage(error));
  }
}

function sectionBodies(summary: string): Map<string, string> {
  const sections = new Map<string, string>();
  let heading: string | undefined;
  let body: Array<string> = [];

  const saveSection = (): void => {
    if (heading !== undefined) {
      sections.set(heading, body.join('\n').trim());
    }
  };

  for (const line of summary.split(/\r?\n/u)) {
    if (line.startsWith('## ')) {
      saveSection();
      heading = line.slice(3).trim();
      body = [];
    } else if (heading !== undefined) {
      body.push(line);
    }
  }
  saveSection();
  return sections;
}

function withoutCodeSpans(value: string): string {
  return value.replaceAll(/```[\s\S]*?```/gu, '').replaceAll(/`[^`\n]*`/gu, '');
}

function containsLanguageMarker(value: string, marker: string): boolean {
  return new RegExp(`\\b${marker}\\b`, 'iu').test(value);
}

function checkSecret(summary: string, secret: string): Array<string> {
  const failures: Array<string> = [];
  if (summary.includes(secret)) {
    failures.push('pasted secret was returned');
  }
  if (!summary.includes('[REDACTED]')) {
    failures.push('summary does not contain [REDACTED]');
  }
  return failures;
}

function checkSectionContains(
  sections: Map<string, string>,
  heading: string,
  expected: string,
  failure: string,
): Array<string> {
  const body = sections.get(heading);
  if (body === undefined) {
    return [`missing ${heading} section`];
  }
  return body.includes(expected) ? [] : [failure];
}

function checkCancelledTask(
  sections: Map<string, string>,
  task: string,
): Array<string> {
  const failures: Array<string> = [];
  for (const heading of ['Active', 'Open Questions and Next Steps']) {
    const body = sections.get(heading);
    if (body === undefined) {
      failures.push(`missing ${heading} section`);
    } else if (body.includes(task)) {
      failures.push(`cancelled task remains under ${heading}`);
    }
  }
  return failures;
}

function checkNonEnglish(sections: Map<string, string>): Array<string> {
  if (sections.size === 0) {
    return ['summary has no Markdown sections'];
  }

  const failures: Array<string> = [];
  const body = withoutCodeSpans([...sections.values()].join('\n'));
  for (const marker of ENGLISH_LANGUAGE_MARKERS) {
    if (containsLanguageMarker(body, marker)) {
      failures.push(`English marker '${marker}' appears in section text`);
    }
  }
  return failures;
}

function evaluateSummary(fixture: Fixture, summary: string): Array<string> {
  const sections = sectionBodies(summary);
  switch (fixture.expectation.kind) {
    case 'secret':
      return checkSecret(summary, fixture.expectation.secret);
    case 'cancelled':
      return checkCancelledTask(sections, fixture.expectation.task);
    case 'danglingQuestion':
      return checkSectionContains(
        sections,
        'Latest Request',
        fixture.expectation.question,
        'dangling question is not quoted under Latest Request',
      );
    case 'correction':
      return checkSectionContains(
        sections,
        'Errors and Corrections',
        fixture.expectation.text,
        'correction is missing from Errors and Corrections',
      );
    case 'nonEnglish':
      return checkNonEnglish(sections);
  }
}

async function runFixture(
  client: ModelClient,
  fixture: Fixture,
): Promise<Outcome> {
  try {
    const request = buildCompactionRequest({
      system: fixture.system,
      previous: undefined,
      absorb: synthesizeMessages(fixture),
    });
    const result = client.streamText({
      system: request.system,
      messages: request.messages,
      chat: { id: fixture.id, lane: 'main' },
      toolChoice: 'none',
    });
    const summary = normalizeCompactionSummary(await result.text);
    if (summary === null) {
      return {
        fixture: fixture.id,
        result: 'FAIL',
        detail: 'model returned no summary text',
      };
    }

    const failures = evaluateSummary(fixture, summary);
    return {
      fixture: fixture.id,
      result: failures.length === 0 ? 'PASS' : 'FAIL',
      detail:
        failures.length === 0 ? 'all assertions passed' : failures.join('; '),
    };
  } catch (error: unknown) {
    return {
      fixture: fixture.id,
      result: 'FAIL',
      detail: errorMessage(error),
    };
  }
}

function printOutcomes(outcomes: Array<Outcome>): void {
  console.log('');
  console.log('Fixture | Result | Details');
  console.log('--- | --- | ---');
  for (const outcome of outcomes) {
    console.log(
      `${outcome.fixture} | ${outcome.result} | ${outcome.detail.replaceAll('|', '/')}`,
    );
  }
}

async function main(): Promise<number> {
  let client: ModelClient;
  let fixtures: Array<Fixture>;
  try {
    client = createEvalModelClient();
    fixtures = loadFixtures();
  } catch (error: unknown) {
    console.error(`FAIL ${errorMessage(error)}`);
    return 1;
  }

  const outcomes: Array<Outcome> = [];
  for (const fixture of fixtures) {
    outcomes.push(await runFixture(client, fixture));
  }
  printOutcomes(outcomes);
  return outcomes.some((outcome) => outcome.result === 'FAIL') ? 1 : 0;
}

void (async (): Promise<void> => {
  process.exitCode = await main();
})();
