import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';

import { externalIdentities, memberships, orgUnits } from './identity';
import { chats, compactions, messages, runEvents, runs } from './chats';
import { pins } from './pins';
import {
  embeddingModelBindings,
  searchChatDocuments,
  searchChatState,
} from './search';
import {
  accounts,
  authenticators,
  sessions,
  users,
  verificationTokens,
} from './auth';

function columnNames(table: PgTable): Array<string> {
  return getTableConfig(table).columns.map((column) => column.name);
}

function indexNames(table: PgTable): Array<string | undefined> {
  return getTableConfig(table).indexes.map((index) => index.config.name);
}

function policyNames(table: PgTable): Array<string> {
  return getTableConfig(table).policies.map((policy) => policy.name);
}

function uniqueConstraintNames(table: PgTable): Array<string | undefined> {
  return getTableConfig(table).uniqueConstraints.map(
    (constraint) => constraint.name,
  );
}

describe('identity schema metadata', () => {
  it('keeps org-unit, membership, and external-identity constraints named and scoped', () => {
    expect(columnNames(orgUnits)).toEqual([
      'id',
      'parent_id',
      'type',
      'name',
      'path',
      'created_by',
      'settings',
      'created_at',
      'updated_at',
    ]);
    expect(indexNames(orgUnits)).toEqual([
      'org_units_path_unique',
      'org_units_parent_idx',
    ]);
    expect(policyNames(orgUnits)).toEqual([
      'org_units_select',
      'org_units_trigger_read',
      'org_units_insert',
      'org_units_update',
      'org_units_delete',
    ]);

    expect(indexNames(memberships)).toEqual([
      'memberships_user_unit_unique',
      'memberships_unit_idx',
    ]);
    expect(policyNames(memberships)).toEqual([
      'memberships_select',
      'memberships_trigger_read',
      'memberships_insert',
      'memberships_update',
      'memberships_delete',
    ]);
    expect(indexNames(externalIdentities)).toEqual([
      'external_identities_provider_subject_unique',
      'external_identities_user_idx',
    ]);
    expect(policyNames(externalIdentities)).toEqual([
      'external_identities_owner',
    ]);
  });
});

describe('chat schema metadata', () => {
  it('keeps chat and message indexes and sharing policies explicit', () => {
    expect(indexNames(chats)).toEqual([
      'chats_owner_updated_idx',
      'chats_id_owner_user_id_unique_idx',
      'chats_project_idx',
    ]);
    expect(policyNames(chats)).toEqual(['chats_owner', 'chats_public_read']);
    expect(indexNames(messages)).toEqual([
      'messages_chat_created_idx',
      'messages_chat_seq_unique_idx',
      'messages_in_reply_to_unique_idx',
      'messages_id_chat_id_unique_idx',
    ]);
    expect(policyNames(messages)).toEqual([
      'messages_owner',
      'messages_public_read',
    ]);
  });

  it('keeps compaction and run event ownership constraints named', () => {
    expect(indexNames(compactions)).toEqual([
      'compactions_chat_upto_seq_idx',
      'compactions_id_chat_id_unique_idx',
    ]);
    expect(policyNames(compactions)).toEqual(['compactions_owner']);
    expect(indexNames(runs)).toEqual([
      'runs_chat_created_idx',
      'runs_user_status_idx',
      'runs_model_context_snapshot_idx',
      'runs_chat_inflight_unique',
    ]);
    expect(policyNames(runs)).toEqual(['runs_owner']);
    expect(indexNames(runEvents)).toEqual(['run_events_run_sequence_idx']);
    expect(policyNames(runEvents)).toEqual([
      'run_events_owner_select',
      'run_events_owner_insert',
    ]);
  });
});

describe('search and pin schema metadata', () => {
  it('keeps search projection indexes and owner policies explicit', () => {
    expect(indexNames(searchChatDocuments)).toEqual([
      'search_chat_documents_chat_ordinal_version_unique',
      'search_chat_documents_fts_idx',
      'search_chat_documents_trgm_idx',
      'search_chat_documents_owner_chat_idx',
      'search_chat_documents_owner_recency_idx',
      'search_chat_documents_embedding_backlog_idx',
    ]);
    expect(policyNames(searchChatDocuments)).toEqual([
      'search_chat_documents_owner',
    ]);
    expect(indexNames(searchChatState)).toEqual([
      'search_chat_state_owner_idx',
    ]);
    expect(policyNames(searchChatState)).toEqual(['search_chat_state_owner']);
    expect(columnNames(embeddingModelBindings)).toEqual([
      'model_key',
      'provider_id',
      'provider_model_id',
      'revision',
      'dimensions',
      'distance_metric',
      'document_prefix',
      'query_prefix',
      'batch_size',
      'created_at',
      'updated_at',
    ]);
  });

  it('keeps pins cross-type ordering constraints and owner policies explicit', () => {
    expect(indexNames(pins)).toEqual(['pins_user_position_idx']);
    expect(uniqueConstraintNames(pins)).toEqual(['pins_user_position_unique']);
    expect(policyNames(pins)).toEqual([
      'pins_owner_select',
      'pins_owner_delete',
      'pins_owner_update',
      'pins_owner_insert',
    ]);
  });
});

describe('auth schema metadata', () => {
  it('keeps account and session indexes and composite keys intact', () => {
    expect(columnNames(users)).toEqual([
      'id',
      'name',
      'email',
      'email_verified',
      'image',
      'password',
    ]);
    expect(indexNames(sessions)).toEqual([
      'sessions_token_hash_unique',
      'sessions_user_created_idx',
      'sessions_user_expires_idx',
      'sessions_expires_idx',
      'sessions_last_seen_at_idx',
    ]);
    expect(columnNames(accounts)).toEqual([
      'userId',
      'type',
      'provider',
      'provider_account_id',
      'refresh_token',
      'access_token',
      'expires_at',
      'token_type',
      'scope',
      'id_token',
      'session_state',
    ]);
    expect(columnNames(verificationTokens)).toEqual([
      'identifier',
      'token',
      'expires',
    ]);
    expect(columnNames(authenticators)).toEqual([
      'credential_id',
      'user_id',
      'provider_account_id',
      'credential_public_key',
      'counter',
      'credential_device_type',
      'credential_backed_up',
      'transports',
    ]);
  });
});
