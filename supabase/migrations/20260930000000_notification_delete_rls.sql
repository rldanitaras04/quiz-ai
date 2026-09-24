-- ============================================================================
-- User-owned notification deletes
-- ============================================================================
-- Users may only delete their own notification rows (RLS already scopes
-- SELECT/UPDATE to the owner).

DROP POLICY IF EXISTS "Users can delete own notifications" ON notifications;
CREATE POLICY "Users can delete own notifications"
  ON notifications FOR DELETE TO authenticated
  USING (user_id = auth.uid());
