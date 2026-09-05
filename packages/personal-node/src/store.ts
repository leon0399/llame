import { migrateState } from './store-migration';
import { isNumber } from '@workspace/runtime-safety';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { privateDirectory } from './private-files';
import { CliError } from './errors';
import { parseJson, text, uuid } from './validation';
import { parseMessage, type Message, type RunEvent } from './types';

/** Local single-owner state, NOT the Hub's database or a replication mirror. */
export class LocalStore {
  readonly db: DatabaseSync;
  readonly nodeId: string;

  constructor(readonly directory: string) {
    privateDirectory(directory);
    const path = join(directory, 'state.sqlite');
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      if (!existsSync(path + suffix)) continue;
      const stat = lstatSync(path + suffix);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (process.platform !== 'win32' && ((stat.mode & 0o077) || (process.getuid && stat.uid !== process.getuid())))) {
        throw new CliError('unsafe_storage', 'State files must be private regular files, never symlinks or hardlinks.');
      }
    }
    this.db = new DatabaseSync(path, { timeout: 5000 });
    if (process.platform !== 'win32') chmodSync(path, 0o600);
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    this.migrate();
    this.db.prepare('INSERT OR IGNORE INTO metadata(key,value) VALUES (?,?)').run('node_id', randomUUID());
    this.nodeId = text(this.db.prepare('SELECT value FROM metadata WHERE key=?').get('node_id')?.value, 'node id');
  }

  close(): void { this.db.close(); }

  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  private migrate(): void {
    this.transaction(() => migrateState(this.db));
  }

  start(chatId: string, prompt: string, snapshot: unknown): string {
    uuid(chatId);
    return this.transaction(() => {
      const runId = randomUUID(); const now = new Date().toISOString();
      this.db.prepare('INSERT OR IGNORE INTO chats VALUES (?,?,?)').run(chatId, prompt.slice(0, 100), now);
      this.db.prepare('INSERT INTO runs VALUES (?,?,?,?,?,NULL)').run(runId, chatId, 'running', JSON.stringify(snapshot), now);
      this.message(chatId, runId, { role: 'user', content: prompt });
      return runId;
    });
  }

  message(chatId: string, runId: string, message: Message): void {
    this.db.prepare('INSERT INTO messages(id,chat_id,run_id,body) VALUES (?,?,?,?)').run(randomUUID(), chatId, runId, JSON.stringify(message));
  }

  history(chatId: string): Message[] {
    const size = this.db.prepare('SELECT COALESCE(SUM(length(CAST(body AS BLOB))),0) AS bytes FROM messages WHERE chat_id=?').get(uuid(chatId));
    if (Number(size?.bytes) > 8_388_608) throw new CliError('history_limit', 'Chat exceeds the local inspection/context limit of 8 MiB. Use a new chat; no records were deleted.');
    // Data was written by this runtime. Validate the key framing again on read.
    return this.db.prepare('SELECT body FROM messages WHERE chat_id=? ORDER BY seq').all(uuid(chatId)).map((row) => {
      return parseMessage(parseJson(text(row.body, 'stored message', 4_194_304)));
    });
  }

  event(runId: string, eventType: string, payload: unknown): RunEvent {
    const row = this.db.prepare(`INSERT INTO events(run_id,sequence,event_type,payload,created_at)
      SELECT ?, COALESCE(MAX(sequence),0)+1, ?, ?, ? FROM events WHERE run_id=? RETURNING sequence`)
      .get(runId, eventType, JSON.stringify(payload), new Date().toISOString(), runId);
    if (!row || !isNumber(row.sequence)) throw new CliError('state_write', 'Could not append event.');
    return { runId, sequence: row.sequence, eventType, payload };
  }

  finish(runId: string, status: string): void {
    this.db.prepare('UPDATE runs SET status=?, finished_at=? WHERE id=? AND status=?')
      .run(status, new Date().toISOString(), runId, 'running');
  }

  chats(): unknown { return this.db.prepare('SELECT * FROM chats ORDER BY created_at DESC LIMIT 100').all(); }
  run(id: string): unknown {
    const row = this.db.prepare('SELECT * FROM runs WHERE id=?').get(uuid(id));
    if (!row) throw new CliError('not_found', 'Local run not found.');
    return { ...row, snapshot: parseJson(text(row.snapshot, 'snapshot', 4_194_304)) };
  }
  runs(): unknown {
    return this.db.prepare('SELECT id,chat_id,status,created_at,finished_at FROM runs ORDER BY created_at DESC LIMIT 100').all();
  }

  eventPage(id: string, after = 0): unknown {
    const run = this.db.prepare('SELECT status FROM runs WHERE id=?').get(uuid(id));
    if (!run) throw new CliError('not_found', 'Local Run not found.');
    // All reads in this method are synchronous; the service cannot append between
    // the status snapshot and this page. A terminal snapshot cannot omit its tail.
    const rows = this.db.prepare('SELECT * FROM events WHERE run_id=? AND sequence>? ORDER BY sequence LIMIT 65').all(id, after);
    const events: RunEvent[] = []; let bytes = 0;
    for (const row of rows.slice(0, 64)) {
      const payload = String(row.payload); const size = Buffer.byteLength(payload);
      if (events.length && bytes + size > 4_194_304) break;
      bytes += size;
      events.push({ runId: id, sequence: Number(row.sequence), eventType: String(row.event_type), payload: parseJson(payload) });
    }
    return { events, hasMore: rows.length > events.length, status: run.status };
  }

  events(id: string, after = 0): RunEvent[] {
    return this.db.prepare('SELECT * FROM events WHERE run_id=? AND sequence>? ORDER BY sequence').all(uuid(id), after)
      .map((row) => ({ runId: id, sequence: Number(row.sequence), eventType: String(row.event_type), payload: parseJson(String(row.payload)) }));
  }

  /** Call only with the execution lock held. Never retry an uncertain action. */
  recover(): void {
    this.transaction(() => {
      const pending = this.db.prepare("SELECT id, chat_id FROM runs WHERE status='running'").all();
      for (const row of pending) {
        const runId = String(row.id); const chatId = String(row.chat_id);
        const calls = new Set<string>();
        const rows = this.db.prepare('SELECT body FROM messages WHERE run_id=? ORDER BY seq').all(runId);
        for (const row of rows) {
          const message = parseMessage(parseJson(String(row.body)));
          for (const call of message.tool_calls ?? []) calls.add(call.id);
          if (message.tool_call_id) calls.delete(message.tool_call_id);
        }
        for (const id of calls) {
          this.message(chatId, runId, { role: 'tool', tool_call_id: id,
            content: JSON.stringify({ status: 'error', type: 'outcome_unknown', message: 'The previous executor stopped. Inspect the workspace before repeating any side effect.' }) });
        }
        this.event(runId, 'run.interrupted', { reason: 'executor_stopped', action: 'Inspect side effects; no action was replayed.' });
        this.finish(runId, 'interrupted');
      }
    });
  }

  cursor(authority: string, user: string, run: string): number {
    const row = this.db.prepare('SELECT sequence FROM remote_cursors WHERE authority=? AND user_id=? AND run_id=?').get(authority, user, run);
    return Number(row?.sequence ?? 0);
  }
  saveCursor(authority: string, user: string, run: string, chat: string, sequence: number): void {
    this.db.prepare(`INSERT INTO remote_cursors VALUES (?,?,?,?,?) ON CONFLICT(authority,user_id,run_id)
      DO UPDATE SET sequence=MAX(sequence,excluded.sequence)`).run(authority, user, run, chat, sequence);
  }
}
