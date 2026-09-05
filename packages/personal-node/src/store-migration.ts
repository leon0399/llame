import { randomUUID } from 'node:crypto';
import { type DatabaseSync } from 'node:sqlite';
import { CliError } from './errors';

/** Called inside BEGIN IMMEDIATE: concurrent starters cannot race migrations. */
export function migrateState(db: DatabaseSync): void {
  const version = db.prepare('PRAGMA user_version').get()?.user_version;
  if (version !== 0 && version !== 1 && version !== 2) throw new CliError('state_version', 'Unsupported local state version.');
  if (version === 2) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chats(id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id),
      status TEXT NOT NULL, snapshot TEXT NOT NULL, created_at TEXT NOT NULL, finished_at TEXT);
    CREATE TABLE IF NOT EXISTS messages(seq INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL REFERENCES chats(id),
      run_id TEXT NOT NULL REFERENCES runs(id), body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events(run_id TEXT NOT NULL REFERENCES runs(id), sequence INTEGER NOT NULL,
      event_type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(run_id,sequence));
    CREATE INDEX IF NOT EXISTS messages_chat ON messages(chat_id,seq);
    CREATE TABLE IF NOT EXISTS remote_cursors(authority TEXT NOT NULL, user_id TEXT NOT NULL, run_id TEXT NOT NULL,
      chat_id TEXT NOT NULL, sequence INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(authority,user_id,run_id));
    ALTER TABLE messages ADD COLUMN id TEXT;
    ALTER TABLE messages ADD COLUMN chat_seq INTEGER;
    CREATE TABLE knowledge_spaces(id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
  `);
  const update = db.prepare('UPDATE messages SET id=? WHERE seq=?');
  for (const row of db.prepare('SELECT seq FROM messages').iterate()) update.run(randomUUID(), Number(row.seq));
  db.exec(`WITH ordinals AS (SELECT seq,ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY seq) AS ordinal FROM messages)
    UPDATE messages SET chat_seq=(SELECT ordinal FROM ordinals WHERE ordinals.seq=messages.seq);
    CREATE UNIQUE INDEX messages_chat_sequence ON messages(chat_id,chat_seq);
    CREATE UNIQUE INDEX messages_identity ON messages(id);
    CREATE VIRTUAL TABLE message_search USING fts5(text, tokenize='trigram');
    CREATE TRIGGER message_search_insert AFTER INSERT ON messages BEGIN
      INSERT INTO message_search(rowid,text) SELECT new.seq,json_extract(new.body,'$.content')
        WHERE json_extract(new.body,'$.role') IN ('user','assistant') AND length(json_extract(new.body,'$.content'))>0;
    END;
    CREATE TRIGGER message_search_delete AFTER DELETE ON messages BEGIN
      DELETE FROM message_search WHERE rowid=old.seq;
    END;
    CREATE TRIGGER message_search_update AFTER UPDATE OF body ON messages BEGIN
      DELETE FROM message_search WHERE rowid=old.seq;
      INSERT INTO message_search(rowid,text) SELECT new.seq,json_extract(new.body,'$.content')
        WHERE json_extract(new.body,'$.role') IN ('user','assistant') AND length(json_extract(new.body,'$.content'))>0;
    END;
    PRAGMA user_version=2;
  `);
  rebuildSearch(db);
}

/** Projection only: never change source text, IDs, timestamps, or approvals. */
export function rebuildSearch(db: DatabaseSync): void {
  db.exec(`DELETE FROM message_search;
    INSERT INTO message_search(rowid,text)
      SELECT seq,json_extract(body,'$.content') FROM messages
      WHERE json_extract(body,'$.role') IN ('user','assistant') AND length(json_extract(body,'$.content'))>0;`);
}
