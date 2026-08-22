import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync } from "node:fs";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";

import {
  createEnrollmentChallenge,
  type EnrollmentChallenge,
  type NodeScope,
  parseNodeScopes,
  verifyEnrollmentProof,
} from "@workspace/federation-experiment/node-enrollment";

export interface SqliteEnrollmentRegistryOptions {
  readonly databasePath: string;
  readonly realmId: string;
}

export interface EnrolledNodeRecord {
  readonly nodeId: string;
  readonly keyId: string;
  readonly enrolledAt: string;
  readonly revokedAt: string | null;
  readonly scopes: readonly NodeScope[];
}

export interface NodeEnrollmentGrant extends EnrolledNodeRecord {
  readonly credential: string;
}

function credentialDigest(credential: string): Buffer {
  return createHash("sha256").update(credential).digest();
}

function parseStoredScopes(input: string): readonly NodeScope[] {
  const parsed: unknown = JSON.parse(input);
  return parseNodeScopes(parsed);
}

function requireText(
  row: Record<string, SQLOutputValue>,
  column: string,
): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw new Error(`invalid enrollment registry ${column}`);
  }
  return value;
}

export class SqliteEnrollmentRegistry {
  readonly #database: DatabaseSync;
  readonly #databasePath: string;
  readonly #realmId: string;

  public constructor(options: SqliteEnrollmentRegistryOptions) {
    if (
      options.databasePath.length === 0 ||
      options.databasePath === ":memory:"
    ) {
      throw new Error("enrollment registry requires a durable database path");
    }
    this.#databasePath = options.databasePath;
    this.#realmId = options.realmId;
    this.#database = new DatabaseSync(options.databasePath);
    try {
      this.#initializeSchema();
      this.#loadOrInitializeRealm();
      this.#secureDatabaseFiles();
    } catch (error) {
      this.#database.close();
      throw error;
    }
  }

  public issueChallenge(options: {
    readonly nodeId: string;
    readonly now?: Date;
  }): EnrollmentChallenge {
    const challenge = createEnrollmentChallenge({
      realmId: this.#realmId,
      nodeId: options.nodeId,
      lifetimeMs: 60_000,
      now: options.now,
    });
    this.#database
      .prepare(
        `INSERT INTO enrollment_challenges
          (nonce, realm_id, node_id, expires_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        challenge.nonce,
        challenge.realmId,
        challenge.nodeId,
        challenge.expiresAt,
      );
    this.#secureDatabaseFiles();
    return challenge;
  }

  public completeEnrollment(
    input: unknown,
    now = new Date(),
    scopesInput: unknown = ["realm.sync"],
  ): NodeEnrollmentGrant {
    const verified = verifyEnrollmentProof(input, {
      expectedRealmId: this.#realmId,
      now,
    });
    const scopes = parseNodeScopes(scopesInput);
    const credential = randomBytes(32).toString("base64url");
    const digest = credentialDigest(credential).toString("hex");
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const challenge = this.#database
        .prepare(
          `SELECT realm_id, node_id, expires_at, consumed_at
           FROM enrollment_challenges
           WHERE nonce = ?`,
        )
        .get(verified.nonce);
      if (challenge === undefined) {
        throw new Error("enrollment challenge is unknown");
      }
      if (
        requireText(challenge, "realm_id") !== verified.realmId ||
        requireText(challenge, "node_id") !== verified.nodeId ||
        requireText(challenge, "expires_at") !== verified.expiresAt
      ) {
        throw new Error("enrollment proof does not match issued challenge");
      }
      if (challenge.consumed_at !== null) {
        throw new Error("enrollment challenge was already consumed");
      }
      const timestamp = now.toISOString();
      this.#database
        .prepare(
          `UPDATE enrollment_challenges
           SET consumed_at = ?
           WHERE nonce = ? AND consumed_at IS NULL`,
        )
        .run(timestamp, verified.nonce);
      this.#database
        .prepare(
          `INSERT INTO enrolled_nodes
            (realm_id, node_id, key_id, public_key_pem, credential_digest,
             scopes_json, enrolled_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          verified.realmId,
          verified.nodeId,
          verified.keyId,
          verified.publicKeyPem,
          digest,
          JSON.stringify(scopes),
          timestamp,
        );
      this.#database.exec("COMMIT");
      this.#secureDatabaseFiles();
      return {
        nodeId: verified.nodeId,
        keyId: verified.keyId,
        enrolledAt: timestamp,
        revokedAt: null,
        scopes,
        credential,
      };
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  public isActive(nodeId: string, keyId: string): boolean {
    return (
      this.#database
        .prepare(
          `SELECT 1
           FROM enrolled_nodes
           WHERE realm_id = ? AND node_id = ? AND key_id = ?
             AND revoked_at IS NULL`,
        )
        .get(this.#realmId, nodeId, keyId) !== undefined
    );
  }

  public authenticate(credential: string): EnrolledNodeRecord | null {
    const row = this.#database
      .prepare(
        `SELECT node_id, key_id, enrolled_at, revoked_at, scopes_json
         FROM enrolled_nodes
         WHERE realm_id = ? AND credential_digest = ? AND revoked_at IS NULL`,
      )
      .get(this.#realmId, credentialDigest(credential).toString("hex"));
    if (row === undefined) return null;
    return {
      nodeId: requireText(row, "node_id"),
      keyId: requireText(row, "key_id"),
      enrolledAt: requireText(row, "enrolled_at"),
      revokedAt: null,
      scopes: parseStoredScopes(requireText(row, "scopes_json")),
    };
  }

  public revoke(nodeId: string, now = new Date()): boolean {
    const result = this.#database
      .prepare(
        `UPDATE enrolled_nodes
         SET revoked_at = ?
         WHERE realm_id = ? AND node_id = ? AND revoked_at IS NULL`,
      )
      .run(now.toISOString(), this.#realmId, nodeId);
    this.#secureDatabaseFiles();
    return result.changes === 1;
  }

  public close(): void {
    this.#database.close();
  }

  #initializeSchema(): void {
    this.#database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS enrollment_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS enrollment_challenges (
        nonce TEXT PRIMARY KEY,
        realm_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS enrolled_nodes (
        realm_id TEXT NOT NULL,
        node_id TEXT PRIMARY KEY,
        key_id TEXT NOT NULL UNIQUE,
        public_key_pem TEXT NOT NULL,
        credential_digest TEXT,
        scopes_json TEXT,
        enrolled_at TEXT NOT NULL,
        revoked_at TEXT
      ) STRICT;
    `);
    const columns = this.#database
      .prepare("PRAGMA table_info(enrolled_nodes)")
      .all();
    if (!columns.some((column) => column.name === "credential_digest")) {
      this.#database.exec(
        "ALTER TABLE enrolled_nodes ADD COLUMN credential_digest TEXT",
      );
    }
    if (!columns.some((column) => column.name === "scopes_json")) {
      this.#database.exec(
        "ALTER TABLE enrolled_nodes ADD COLUMN scopes_json TEXT",
      );
    }
    this.#database.exec(
      `UPDATE enrolled_nodes SET scopes_json = '["realm.sync"]'
       WHERE scopes_json IS NULL`,
    );
  }

  #loadOrInitializeRealm(): void {
    const row = this.#database
      .prepare("SELECT value FROM enrollment_metadata WHERE key = 'realm_id'")
      .get();
    if (row === undefined) {
      this.#database
        .prepare(
          "INSERT INTO enrollment_metadata (key, value) VALUES ('realm_id', ?)",
        )
        .run(this.#realmId);
      return;
    }
    if (requireText(row, "value") !== this.#realmId) {
      throw new Error("enrollment registry belongs to a different Realm");
    }
  }

  #secureDatabaseFiles(): void {
    for (const path of [
      this.#databasePath,
      `${this.#databasePath}-wal`,
      `${this.#databasePath}-shm`,
    ]) {
      if (existsSync(path)) chmodSync(path, 0o600);
    }
  }
}
