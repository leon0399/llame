import { InferSelectModel, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth';

// SPEC §14.1: most "providers" are OpenAI-compatible endpoints distinguished
// only by base_url — presets, not adapters. v0.4 ships openai_compatible and
// openrouter (a NATIVE adapter by mandate of #82 — not a base_url preset);
// the rest of the SPEC vocabulary is enum-reserved so adding an adapter is
// never an enum migration.
export const providerType = pgEnum('provider_type', [
  'openai_compatible',
  'openrouter',
  'anthropic',
  'google_gemini',
  'aws_bedrock',
  'ollama',
  'custom_http',
]);

export const providerAuthMode = pgEnum('provider_auth_mode', [
  'api_key',
  'oauth',
  'none',
]);

export const credentialSecretType = pgEnum('credential_secret_type', [
  'api_key',
  'oauth_token',
  'pat',
  'service_account',
  'local_socket',
]);

// Provider accounts attach to the owner scope chain (SPEC §14.1). Chat scope
// is deliberately absent — a provider bound to a single conversation has no
// use case; org-scope resolution arrives when chats attach to org units.
export const providerScopeType = pgEnum('provider_scope_type', [
  'org_unit',
  'user',
]);

/**
 * A configured model provider (#18, SPEC §14.1): the non-secret half of
 * BYOK. `models_cache` stays null until catalog sync (#84).
 */
export const providerAccounts = pgTable(
  'provider_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerScopeType: providerScopeType('owner_scope_type').notNull(),
    ownerScopeId: text('owner_scope_id').notNull(),
    providerType: providerType('provider_type').notNull(),
    displayName: text('display_name').notNull(),
    authMode: providerAuthMode('auth_mode').notNull().default('api_key'),
    baseUrl: text('base_url'),
    // Preferred model id for this account (v0.4-minimal router input); null =
    // the adapter default.
    defaultModel: text('default_model'),
    modelsCache: jsonb('models_cache'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('provider_accounts_scope_idx').on(t.ownerScopeType, t.ownerScopeId),
    // RLS (FORCE hand-appended in the migration). Same read/write split as
    // policies (#45): an org-scope provider BINDS/serves subtree members, so
    // they can read it (never its secret — that lives in `credentials`);
    // writes need owner/admin on the unit or an ancestor. User scope is
    // own-rows-only both ways.
    pgPolicy('provider_accounts_select', {
      for: 'select',
      using: sql.raw(`(
        (owner_scope_type = 'user' AND owner_scope_id = current_setting('app.current_user_id', true))
        OR (owner_scope_type = 'org_unit' AND (
          EXISTS (
            SELECT 1 FROM memberships m
            JOIN org_units mu ON mu.id = m.org_unit_id
            WHERE m.user_id = current_setting('app.current_user_id', true)
              AND provider_accounts.owner_scope_id = ANY(string_to_array(mu.path, '/'))
          )
          OR EXISTS (
            SELECT 1 FROM org_units u
            WHERE u.id::text = provider_accounts.owner_scope_id
              AND EXISTS (
                SELECT 1 FROM memberships m2
                WHERE m2.user_id = current_setting('app.current_user_id', true)
                  AND m2.org_unit_id::text = ANY(string_to_array(u.path, '/'))
              )
          )
        ))
      )`),
    }),
    pgPolicy('provider_accounts_write', {
      for: 'all',
      using: providerWriteClause(),
      withCheck: providerWriteClause(),
    }),
  ],
).enableRLS();

function providerWriteClause() {
  return sql.raw(`(
    (owner_scope_type = 'user' AND owner_scope_id = current_setting('app.current_user_id', true))
    OR (owner_scope_type = 'org_unit' AND EXISTS (
      SELECT 1 FROM org_units u
      WHERE u.id::text = provider_accounts.owner_scope_id
        AND EXISTS (
          SELECT 1 FROM memberships m
          WHERE m.user_id = current_setting('app.current_user_id', true)
            AND m.role IN ('owner','admin')
            AND m.org_unit_id::text = ANY(string_to_array(u.path, '/'))
        )
    ))
  )`);
}

export type ProviderAccount = InferSelectModel<typeof providerAccounts>;
export type ProviderType = (typeof providerType.enumValues)[number];
export type ProviderScopeType = (typeof providerScopeType.enumValues)[number];

/**
 * Encrypted provider secrets (#18, SPEC §14.2). `encrypted_payload` is an
 * AES-256-GCM envelope (see credential-crypto.ts) bound via AAD to the
 * provider account id + secret type, so a ciphertext cannot be replayed onto
 * a different account row. `key_version` selects the master key that sealed
 * it — rotation = add a new master key version, re-encrypt lazily.
 *
 * Deliberately NO owner columns: ownership is the parent account's, enforced
 * by RLS through the FK (a credential is never more visible than its
 * account). Secret material NEVER leaves apps/api.
 */
export const credentials = pgTable(
  'credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerAccountId: uuid('provider_account_id')
      .notNull()
      .references(() => providerAccounts.id, { onDelete: 'cascade' }),
    secretType: credentialSecretType('secret_type')
      .notNull()
      .default('api_key'),
    encryptedPayload: text('encrypted_payload').notNull(),
    keyVersion: integer('key_version').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdBy: text('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('credentials_account_idx').on(t.providerAccountId),
    // Visibility strictly follows the parent account: reads for anyone who
    // can read the account (the WORKER decrypts for org members using an
    // org-scope provider), writes only for whoever can WRITE the account —
    // expressed by scanning provider_accounts, whose own policies apply
    // (its chains terminate in memberships' own-rows policy: no recursion).
    pgPolicy('credentials_select', {
      for: 'select',
      using: sql.raw(`EXISTS (
        SELECT 1 FROM provider_accounts pa
        WHERE pa.id = credentials.provider_account_id
      )`),
    }),
    pgPolicy('credentials_write', {
      for: 'all',
      using: credentialsWriteClause(),
      withCheck: credentialsWriteClause(),
    }),
  ],
).enableRLS();

/** Writable iff the parent account is writable by the current user. */
function credentialsWriteClause() {
  return sql.raw(`EXISTS (
    SELECT 1 FROM provider_accounts pa
    WHERE pa.id = credentials.provider_account_id
      AND (
        (pa.owner_scope_type = 'user' AND pa.owner_scope_id = current_setting('app.current_user_id', true))
        OR (pa.owner_scope_type = 'org_unit' AND EXISTS (
          SELECT 1 FROM org_units u
          WHERE u.id::text = pa.owner_scope_id
            AND EXISTS (
              SELECT 1 FROM memberships m
              WHERE m.user_id = current_setting('app.current_user_id', true)
                AND m.role IN ('owner','admin')
                AND m.org_unit_id::text = ANY(string_to_array(u.path, '/'))
            )
        ))
      )
  )`);
}

export type Credential = InferSelectModel<typeof credentials>;
export type CredentialSecretType =
  (typeof credentialSecretType.enumValues)[number];
