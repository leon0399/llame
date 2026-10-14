ALTER POLICY "pins_owner_update" ON "pins" TO public USING (user_id = current_setting('app.current_user_id', true)) WITH CHECK (user_id = current_setting('app.current_user_id', true) AND (
        (item_type = 'chat' AND item_id IN (SELECT id FROM chats WHERE owner_user_id = current_setting('app.current_user_id', true)))
        OR (item_type = 'project' AND item_id IN (SELECT id FROM projects WHERE owner_user_id = current_setting('app.current_user_id', true)))
      ));