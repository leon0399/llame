import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { LocalStore } from '../dist/store.js';
import { ConversationRecall } from '../dist/recall.js';
import { PersonalKnowledge } from '../dist/knowledge.js';
import { MemoryTools } from '../dist/memory-tools.js';
import { rebuildSearch } from '../dist/store-migration.js';

function store(t) {
  const dir = mkdtempSync(join(tmpdir(), 'llame-node-memory-'));
  const result = new LocalStore(dir); t.after(() => result.close()); return result;
}
function add(db, content, role = 'assistant', chatId = randomUUID()) {
  const runId = db.start(chatId, 'question', {});
  db.message(chatId, runId, { role, content, ...(role === 'tool' ? { tool_call_id: 'call' } : {}) });
  db.finish(runId, 'completed'); return { chatId, runId };
}
const signal = () => new AbortController().signal;

test('literal Unicode recall searches source text and excludes the current Chat', t => {
  const db = store(t); const recall = new ConversationRecall(db);
  const first = add(db, 'Architecture decision: postgres indexing.\nПРИВЕТ Мир\ninformación almacenada\n中文测试');
  const second = add(db, 'Another postgres indexing opinion.');
  for (const query of ['привет', 'información', '中文测']) {
    const found = recall.search({ query }); assert.equal(found.results.length, 1); assert.equal(found.results[0].chatId, first.chatId);
    assert.match(found.results[0].messageId, /^[0-9a-f-]{36}$/); assert.ok(found.results[0].source.includes(db.nodeId));
  }
  const found = recall.search({ query: 'postgres', limit: 10 }, second.chatId);
  assert.equal(found.results.length, 1); assert.equal(found.results[0].chatId, first.chatId);
  assert.equal(found.coverage.synchronized, false); assert.equal(found.coverage.kind, 'local-lexical-trigram');
  assert.throws(() => recall.search({ query: '中' }), { code: 'query_too_short' });
  assert.throws(() => recall.search({ query: 'postgres', owner: first.chatId }), { code: 'unknown_field' });
});

test('FTS operators are literal and tool/system/hidden reasoning is not searchable', t => {
  const db = store(t); const recall = new ConversationRecall(db);
  add(db, 'operator OR literal'); add(db, 'hidden_observation_token', 'tool'); add(db, 'hidden_system_token', 'system');
  const { chatId, runId } = add(db, 'visible answer');
  db.message(chatId, runId, { role: 'assistant', content: 'public output', reasoning_content: 'hidden_reasoning_token' });
  for (const query of ['hidden_observation_token', 'hidden_system_token', 'hidden_reasoning_token', '" OR "', 'NEAR(foo)']) {
    assert.equal(recall.search({ query }).results.length, 0, query);
  }
  assert.equal(recall.search({ query: 'operator OR literal' }).results.length, 1);
  const tool = db.db.prepare("SELECT chat_seq,chat_id FROM messages WHERE json_extract(body,'$.role')='tool'").get();
  assert.throws(() => recall.read({ chatId: tool.chat_id, messageSeq: tool.chat_seq }), { code: 'conversation_source_not_found' });
});

test('conversation reads preserve shared CRLF/blank-line coordinates, bounds and source ownership', t => {
  const db = store(t); const recall = new ConversationRecall(db);
  const first = add(db, 'first\r\n\r\nпривет\nlast\rremain\n');
  const other = add(db, 'separate conversation');
  const hit = recall.search({ query: 'привет' }).results[0];
  const read = recall.read({ chatId: first.chatId, messageSeq: hit.messageSeq, offset: 1, limit: 2 });
  assert.equal(read.content, '\r\nпривет\n'); assert.equal(read.lineCount, 2); assert.equal(read.nextOffset, 3);
  assert.equal(read.messageId, hit.messageId); assert.equal(read.cutReason, 'line_limit');
  assert.throws(() => recall.read({ chatId: randomUUID(), messageSeq: hit.messageSeq }), { code: 'conversation_source_not_found' });
  assert.equal(recall.read({ chatId: other.chatId, messageSeq: hit.messageSeq }).content, 'separate conversation');
  assert.throws(() => recall.read({ chatId: first.chatId, messageSeq: hit.messageSeq, offset: 4 }), { code: 'conversation_range_invalid' });
  assert.throws(() => recall.read({ chatId: first.chatId, messageSeq: hit.messageSeq, limit: 2001 }), { code: 'invalid_data' });
  add(db, 'oversized ' + 'x'.repeat(15000));
  const large = recall.search({ query: 'oversized' }).results[0];
  assert.throws(() => recall.read(large), { code: 'unknown_field' });
  assert.throws(() => recall.read({ chatId: large.chatId, messageSeq: large.messageSeq }), { code: 'conversation_limit_exceeded' });
});

test('derived recall index is transactionally maintained and rebuilt without changing sources', t => {
  const db = store(t); const recall = new ConversationRecall(db); add(db, 'original phrase');
  const hit = recall.search({ query: 'original' }).results[0];
  db.db.prepare('UPDATE messages SET body=? WHERE id=?').run(JSON.stringify({ role: 'assistant', content: 'replacement phrase' }), hit.messageId);
  assert.equal(recall.search({ query: 'original' }).results.length, 0);
  assert.equal(recall.search({ query: 'replacement' }).results[0].messageId, hit.messageId);
  const before = db.db.prepare('SELECT * FROM messages ORDER BY seq').all();
  db.db.exec('DELETE FROM message_search'); assert.equal(recall.search({ query: 'replacement' }).results.length, 0);
  db.transaction(() => rebuildSearch(db.db));
  assert.deepEqual(db.db.prepare('SELECT * FROM messages ORDER BY seq').all(), before);
  assert.equal(recall.search({ query: 'replacement' }).results.length, 1);
  db.db.prepare('DELETE FROM messages WHERE id=?').run(hit.messageId);
  assert.equal(recall.search({ query: 'replacement' }).results.length, 0);
});

test('version-one transcripts and source identities survive migration and reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'llame-node-migrate-')); const path = join(dir, 'state.sqlite');
  const old = new DatabaseSync(path); chmodSync(path, 0o600);
  const nodeId = randomUUID(); const chat = randomUUID(); const run = randomUUID();
  old.exec(`CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE chats(id TEXT PRIMARY KEY,title TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE runs(id TEXT PRIMARY KEY,chat_id TEXT NOT NULL,status TEXT NOT NULL,snapshot TEXT NOT NULL,created_at TEXT NOT NULL,finished_at TEXT);
    CREATE TABLE messages(seq INTEGER PRIMARY KEY AUTOINCREMENT,chat_id TEXT NOT NULL,run_id TEXT NOT NULL,body TEXT NOT NULL); PRAGMA user_version=1;`);
  const body = JSON.stringify({ role: 'user', content: 'Before migration\r\nexact bytes.' });
  old.prepare('INSERT INTO metadata VALUES (?,?)').run('node_id', nodeId);
  old.prepare('INSERT INTO chats VALUES (?,?,?)').run(chat, 'Old', '2026-01-01');
  old.prepare('INSERT INTO runs VALUES (?,?,?,?,?,?)').run(run, chat, 'completed', '{}', '2026-01-01', '2026-01-01');
  old.prepare('INSERT INTO messages(chat_id,run_id,body) VALUES (?,?,?)').run(chat, run, body); old.close();
  const first = new LocalStore(dir);
  const row = first.db.prepare('SELECT * FROM messages').get(); assert.equal(row.body, body); assert.equal(first.nodeId, nodeId);
  assert.equal(first.db.prepare('PRAGMA user_version').get().user_version, 2);
  assert.equal(new ConversationRecall(first).search({ query: 'migration' }).results[0].messageId, row.id); first.close();
  const second = new LocalStore(dir); assert.equal(second.db.prepare('SELECT id FROM messages').get().id, row.id); second.close();
});

test('Knowledge is live, provider-independent and identities never merge by name', async t => {
  const db = store(t); const knowledge = new PersonalKnowledge(db);
  assert.deepEqual(knowledge.list(), []);
  const space = knowledge.create({ name: 'Notes' }); const distinct = knowledge.create({ name: 'Notes' }); assert.notEqual(space.id, distinct.id);
  writeFileSync(join(space.directory, 'decision.md'), 'Indexing\nUse postgres.\n', { mode: 0o600 });
  let found = await knowledge.search({ query: 'postgres' }, signal());
  assert.equal(found.results.length, 1); assert.equal(found.results[0].knowledgeSpaceId, space.id);
  let read = await knowledge.read({ knowledgeSpaceId: space.id, path: 'decision.md', offset: 1, limit: 1 }, signal());
  assert.equal(read.content, '2: Use postgres.\n');
  writeFileSync(join(space.directory, 'decision.md'), 'Changed to sqlite.\n');
  found = await knowledge.search({ query: 'postgres' }, signal()); assert.equal(found.results.length, 0);
  read = await knowledge.read({ knowledgeSpaceId: space.id, path: 'decision.md' }, signal()); assert.equal(read.content, '1: Changed to sqlite.\n');
  assert.throws(() => knowledge.create({ name: 'Injected', directory: '/' }), { code: 'unknown_field' });
});

test('Knowledge denies traversal, symlinks, unknown spaces and invalid UTF-8; failure coverage is explicit', async t => {
  const db = store(t); const knowledge = new PersonalKnowledge(db); const space = knowledge.create({ name: 'Private' });
  writeFileSync(join(db.directory, 'secret.md'), 'sensitive source');
  writeFileSync(join(space.directory, 'invalid.md'), Buffer.from([0xff, 0xfe]));
  mkdirSync(join(space.directory, 'subdir')); symlinkSync(join(db.directory, 'secret.md'), join(space.directory, 'escape.md'));
  for (const path of ['../secret.md', '/etc/passwd', 'subdir/../../secret.md', 'escape.md', 'a\\b.md']) {
    await assert.rejects(knowledge.read({ knowledgeSpaceId: space.id, path }, signal()), { code: 'knowledge_path_invalid' });
  }
  await assert.rejects(knowledge.read({ knowledgeSpaceId: randomUUID(), path: 'x.md' }, signal()), { code: 'knowledge_space_not_found' });
  await assert.rejects(knowledge.read({ knowledgeSpaceId: space.id, path: 'invalid.md' }, signal()), { code: 'knowledge_content_invalid' });
  const found = await knowledge.search({ query: 'sensitive' }, signal());
  assert.equal(found.coverage.complete, false); assert.equal(found.coverage.failures.length, 1); assert.deepEqual(found.results, []);
});

test('Run-bound Knowledge grants do not grow when new spaces appear', async t => {
  const db = store(t); const knowledge = new PersonalKnowledge(db);
  const tools = new MemoryTools(db, randomUUID()); assert.equal(tools.has('knowledge_read'), false);
  const before = knowledge.create({ name: 'Before' }); const bound = new MemoryTools(db, randomUUID());
  const later = knowledge.create({ name: 'Later' }); writeFileSync(join(later.directory, 'new.md'), 'ungranted new source');
  assert.deepEqual(bound.spaces.map(space => space.id), [before.id]);
  await assert.rejects(bound.execute('knowledge_read', { knowledgeSpaceId: later.id, path: 'new.md' }, signal()), { code: 'knowledge_space_not_found' });
  const found = await bound.execute('knowledge_search', { query: 'ungranted' }, signal()); assert.equal(found.results.length, 0);
});

test('event replay is bounded, ordered and retains terminal status across every page', t => {
  const db = store(t); const { runId } = add(db, 'events');
  for (let i = 0; i < 150; i++) db.event(runId, 'test.event', { index: i });
  const collected = []; let after = 0;
  for (;;) {
    const page = db.eventPage(runId, after); assert.ok(page.events.length <= 64); assert.equal(page.status, 'completed');
    collected.push(...page.events); after = page.events.at(-1)?.sequence ?? after;
    if (!page.hasMore) break;
  }
  assert.deepEqual(collected.map(e => e.sequence), Array.from({ length: 150 }, (_, i) => i + 1));
  assert.throws(() => db.eventPage(randomUUID()), { code: 'not_found' });
});

 test('source sequences are dense within each Chat, never global database row IDs', t => {
  const db = store(t); const recall = new ConversationRecall(db);
  const first = add(db, 'first independent source'); const second = add(db, 'second independent source');
  const one = recall.search({ query: 'first independent' }).results[0];
  const two = recall.search({ query: 'second independent' }).results[0];
  assert.equal(one.messageSeq, 2); assert.equal(two.messageSeq, 2); assert.notEqual(one.messageId, two.messageId);
  assert.equal(recall.read({ chatId: first.chatId, messageSeq: 2 }).content, 'first independent source');
  assert.equal(recall.read({ chatId: second.chatId, messageSeq: 2 }).content, 'second independent source');
});
