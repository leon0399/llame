ALTER POLICY "configs_select" ON "configs" TO public USING ((
        (scope_type = 'user' AND scope_id = current_setting('app.current_user_id', true))
        OR (scope_type = 'chat' AND EXISTS (
          SELECT 1 FROM chats c
          WHERE c.id::text = configs.scope_id
            AND c.owner_user_id = current_setting('app.current_user_id', true)
        ))
        OR (scope_type = 'org_unit' AND (
          EXISTS (
            SELECT 1 FROM memberships m
            JOIN org_units mu ON mu.id = m.org_unit_id
            WHERE m.user_id = current_setting('app.current_user_id', true)
              AND configs.scope_id = ANY(string_to_array(mu.path, '/'))
          )
          OR EXISTS (
            SELECT 1 FROM org_units u
            WHERE u.id::text = configs.scope_id
              AND EXISTS (
                SELECT 1 FROM memberships m2
                WHERE m2.user_id = current_setting('app.current_user_id', true)
                  AND m2.org_unit_id::text = ANY(string_to_array(u.path, '/'))
              )
          )
        ))
      ));--> statement-breakpoint
ALTER POLICY "policies_select" ON "policies" TO public USING ((
        (scope_type = 'user' AND scope_id = current_setting('app.current_user_id', true))
        OR (scope_type = 'chat' AND EXISTS (
          SELECT 1 FROM chats c
          WHERE c.id::text = policies.scope_id
            AND c.owner_user_id = current_setting('app.current_user_id', true)
        ))
        OR (scope_type = 'org_unit' AND (
          EXISTS (
            SELECT 1 FROM memberships m
            JOIN org_units mu ON mu.id = m.org_unit_id
            WHERE m.user_id = current_setting('app.current_user_id', true)
              AND policies.scope_id = ANY(string_to_array(mu.path, '/'))
          )
          OR EXISTS (
            SELECT 1 FROM org_units u
            WHERE u.id::text = policies.scope_id
              AND EXISTS (
                SELECT 1 FROM memberships m2
                WHERE m2.user_id = current_setting('app.current_user_id', true)
                  AND m2.org_unit_id::text = ANY(string_to_array(u.path, '/'))
              )
          )
        ))
      ));