import { readFileSync } from 'node:fs';
import path from 'node:path';

import { isNumber, isRecord, isString } from '@workspace/runtime-safety';
import type { UnknownRecord } from '@workspace/runtime-safety';

import {
  buildCompactionRequest,
  normalizeCompactionSummary,
} from '../../src/compaction/compaction';
import { loadInstanceConfig } from '../../src/instance-config/config-loader';
import type { LlameConfig } from '../../src/instance-config/llame-config';
import { loadProductUserAgent } from '../../src/instance-config/product-identity';
import { ModelsService } from '../../src/models/models.service';
import type { ModelClient } from '../../src/models/model-client';
import type { StoredMessage, TextPart } from '../../src/chats/context-builder';

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

type FixtureExpectation =
  | { kind: 'correction'; text: string }
  | { kind: 'cancelled'; task: string }
  | { kind: 'secret'; secret: string }
  | { kind: 'nonEnglish' }
  | { kind: 'danglingQuestion'; question: string };

type Fixture = {
  id: string;
  system: string;
  messages: Array<StoredMessage>;
  expectation: FixtureExpectation;
};

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

function requiredStringField(
  record: UnknownRecord,
  key: string,
  label: string,
): string {
  const value = record[key];
  if (!isString(value) || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function parseRole(
  record: UnknownRecord,
  label: string,
): StoredMessage['role'] {
  switch (record.role) {
    case 'user':
    case 'assistant':
    case 'system':
    case 'tool':
    case 'checkpoint':
      return record.role;
    default:
      throw new Error(`${label} must be a stored message role`);
  }
}

function parseTextParts(record: UnknownRecord, label: string): Array<TextPart> {
  const value = record.parts;
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }

  const parts: Array<TextPart> = [];
  for (const [index, rawPart] of value.entries()) {
    if (
      !isRecord(rawPart) ||
      rawPart.type !== 'text' ||
      !isString(rawPart.text)
    ) {
      throw new Error(`${label}[${index}] must be a text part`);
    }
    parts.push({ type: 'text', text: rawPart.text });
  }
  return parts;
}

function parseStoredMessage(value: unknown, label: string): StoredMessage {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }

  const createdAtText = requiredStringField(
    value,
    'createdAt',
    `${label}.createdAt`,
  );
  const createdAt = new Date(createdAtText);
  if (Number.isNaN(createdAt.valueOf())) {
    throw new Error(`${label}.createdAt must be an ISO date`);
  }

  const seq = value.seq;
  if (!isNumber(seq) || !Number.isInteger(seq)) {
    throw new Error(`${label}.seq must be an integer`);
  }

  const senderUserIdValue = value.senderUserId;
  if (senderUserIdValue !== null && !isString(senderUserIdValue)) {
    throw new Error(`${label}.senderUserId must be a string or null`);
  }
  if (!Array.isArray(value.attachments)) {
    throw new Error(`${label}.attachments must be an array`);
  }

  const message: StoredMessage = {
    id: requiredStringField(value, 'id', `${label}.id`),
    chatId: requiredStringField(value, 'chatId', `${label}.chatId`),
    seq,
    role: parseRole(value, `${label}.role`),
    senderUserId: senderUserIdValue,
    parts: parseTextParts(value, `${label}.parts`),
    attachments: value.attachments,
    createdAt,
  };
  if (value.usage !== undefined) {
    message.usage = value.usage;
  }
  return message;
}

function parseExpectation(value: unknown, label: string): FixtureExpectation {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }

  const kind = requiredStringField(value, 'kind', `${label}.kind`);
  switch (kind) {
    case 'correction':
      return {
        kind,
        text: requiredStringField(value, 'text', `${label}.text`),
      };
    case 'cancelled':
      return {
        kind,
        task: requiredStringField(value, 'task', `${label}.task`),
      };
    case 'secret':
      return {
        kind,
        secret: requiredStringField(value, 'secret', `${label}.secret`),
      };
    case 'nonEnglish':
      return { kind };
    case 'danglingQuestion':
      return {
        kind,
        question: requiredStringField(value, 'question', `${label}.question`),
      };
    default:
      throw new Error(`${label}.kind is not a supported fixture check`);
  }
}

function parseFixture(value: unknown, label: string): Fixture {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  if (!Array.isArray(value.messages)) {
    throw new Error(`${label}.messages must be an array`);
  }

  const messages: Array<StoredMessage> = [];
  for (const [index, rawMessage] of value.messages.entries()) {
    messages.push(
      parseStoredMessage(rawMessage, `${label}.messages[${index}]`),
    );
  }

  return {
    id: requiredStringField(value, 'id', `${label}.id`),
    system: requiredStringField(value, 'system', `${label}.system`),
    messages,
    expectation: parseExpectation(value.expectation, `${label}.expectation`),
  };
}

function loadFixture(fileName: string): Fixture {
  const filePath = path.resolve(__dirname, 'fixtures', fileName);
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
    return parseFixture(parsed, fileName);
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
      absorb: fixture.messages,
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
