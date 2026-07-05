CREATE TYPE "public"."credential_secret_type" AS ENUM('api_key', 'oauth_token', 'pat', 'service_account', 'local_socket');--> statement-breakpoint
CREATE TYPE "public"."provider_auth_mode" AS ENUM('api_key', 'oauth', 'none');--> statement-breakpoint
CREATE TYPE "public"."provider_scope_type" AS ENUM('org_unit', 'user');--> statement-breakpoint
CREATE TYPE "public"."provider_type" AS ENUM('openai_compatible', 'anthropic', 'google_gemini', 'aws_bedrock', 'ollama', 'custom_http');--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_account_id" uuid NOT NULL,
	"secret_type" "credential_secret_type" DEFAULT 'api_key' NOT NULL,
	"encrypted_payload" text NOT NULL,
	"key_version" integer NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" text,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "provider_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_scope_type" "provider_scope_type" NOT NULL,
	"owner_scope_id" text NOT NULL,
	"provider_type" "provider_type" NOT NULL,
	"display_name" text NOT NULL,
	"auth_mode" "provider_auth_mode" DEFAULT 'api_key' NOT NULL,
	"base_url" text,
	"default_model" text,
	"models_cache" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_provider_account_id_provider_accounts_id_fk" FOREIGN KEY ("provider_account_id") REFERENCES "public"."provider_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credentials_account_idx" ON "credentials" USING btree ("provider_account_id");--> statement-breakpoint
CREATE INDEX "provider_accounts_scope_idx" ON "provider_accounts" USING btree ("owner_scope_type","owner_scope_id");--> statement-breakpoint
CREATE POLICY "credentials_select" ON "credentials" AS PERMISSIVE FOR SELECT TO public USING (EXISTS (
        SELECT 1 FROM provider_accounts pa
        WHERE pa.id = credentials.provider_account_id
      ));--> statement-breakpoint
CREATE POLICY "credentials_write" ON "credentials" AS PERMISSIVE FOR ALL TO public USING (EXISTS (
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
  )) WITH CHECK (EXISTS (
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
  ));--> statement-breakpoint
CREATE POLICY "provider_accounts_select" ON "provider_accounts" AS PERMISSIVE FOR SELECT TO public USING ((
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
      ));--> statement-breakpoint
CREATE POLICY "provider_accounts_write" ON "provider_accounts" AS PERMISSIVE FOR ALL TO public USING ((
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
  )) WITH CHECK ((
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
  ));--> statement-breakpoint
ALTER TABLE "provider_accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "credentials" FORCE ROW LEVEL SECURITY;