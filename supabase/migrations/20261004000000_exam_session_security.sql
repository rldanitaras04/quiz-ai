-- ============================================================================
-- Examination Session & Integrity Layer
-- ============================================================================
-- Additive migration for the examination session, security policy, live
-- monitoring and synchronization architecture. Every statement is idempotent.
--
-- Contents:
--   1) Repair drift: assessment_exceptions.expires_at (referenced by
--      enforce_attempt_limit() and src/lib/assessment-exceptions.ts but never
--      created — the trigger swallowed the error and silently ignored
--      additional_attempt exceptions).
--   2) Faculty-configurable security policy on assessment_deployments
--      (standard / enhanced / lockdown_ready + per-option toggles).
--   3) exam_sessions — the single active examination session, heartbeat
--      presence and current session state. One row per session; heartbeat
--      updates this row in place (no append-only heartbeat spam). Meaningful
--      transitions are persisted as exam_events instead.
--   4) exam_events — recreation of the 20260921 migration, which is recorded
--      in the ledger but absent from the database, with the corrected faculty
--      RLS policy (faculty_assignments.faculty_id, not the non-existent
--      user_id), an extended factual event vocabulary and a denormalized
--      deployment_id for realtime filtering.
--   5) review_notes — same 20260921 drift, recreated with corrected policy.
--   6) student_responses.last_operation_id — idempotency key so a retried
--      synchronization operation after a lost acknowledgement applies exactly
--      once.
--   7) Indexes justified by monitor/heartbeat/timeline query patterns.
--   8) Supabase Realtime publication membership for exam_sessions/exam_events
--      (RLS is NOT disabled; subscribers only receive rows their role may
--      SELECT).
--
-- Non-goals: no table is dropped, no policy is weakened, no service-role
-- grant is introduced, answer keys stay student-inaccessible.

-- ---------------------------------------------------------------------------
-- 1) assessment_exceptions.expires_at (drift repair)
-- ---------------------------------------------------------------------------
ALTER TABLE assessment_exceptions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- 2) Deployment security policy
-- ---------------------------------------------------------------------------
ALTER TABLE assessment_deployments
  ADD COLUMN IF NOT EXISTS security_mode TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS require_fullscreen BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS detect_fullscreen_exit BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS detect_tab_visibility BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS detect_focus_loss BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS record_page_reloads BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS detect_concurrent_sessions BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS detect_copy_attempts BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS detect_paste_attempts BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS detect_context_menu BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS require_face_verification BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS require_liveness_verification BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS require_reverification_on_recovery BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS offline_autosave BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sync_on_reconnect BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS record_connection_events BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_session_recovery BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS security_response_mode TEXT NOT NULL DEFAULT 'record';

ALTER TABLE assessment_deployments DROP CONSTRAINT IF EXISTS assessment_deployments_security_mode_check;
ALTER TABLE assessment_deployments
  ADD CONSTRAINT assessment_deployments_security_mode_check
  CHECK (security_mode IN ('standard', 'enhanced', 'lockdown_ready'));

ALTER TABLE assessment_deployments DROP CONSTRAINT IF EXISTS assessment_deployments_security_response_mode_check;
ALTER TABLE assessment_deployments
  ADD CONSTRAINT assessment_deployments_security_response_mode_check
  CHECK (security_response_mode IN ('record', 'warn', 'reverify'));

-- ---------------------------------------------------------------------------
-- 3) exam_sessions — single active session + heartbeat presence
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exam_sessions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id               UUID NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
  student_id               UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  deployment_id            UUID NOT NULL REFERENCES assessment_deployments(id) ON DELETE CASCADE,
  -- Server-issued capability token. The client must present it for every
  -- session mutation; ids alone are never trusted because they came from a page.
  session_token            UUID NOT NULL DEFAULT gen_random_uuid(),
  status                   TEXT NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'closed', 'transferred', 'terminated')),
  -- Display-only progress state (never answer contents).
  current_item             INTEGER NOT NULL DEFAULT 1,
  total_items              INTEGER,
  answered_count           INTEGER NOT NULL DEFAULT 0,
  flagged_count            INTEGER NOT NULL DEFAULT 0,
  connection_state         TEXT NOT NULL DEFAULT 'online'
                             CHECK (connection_state IN ('online', 'offline', 'unknown')),
  sync_state               TEXT NOT NULL DEFAULT 'synced'
                             CHECK (sync_state IN ('synced', 'syncing', 'pending', 'error')),
  pending_sync_count       INTEGER NOT NULL DEFAULT 0,
  last_heartbeat_at        TIMESTAMPTZ,
  last_local_save_at       TIMESTAMPTZ,
  last_sync_at             TIMESTAMPTZ,
  -- Faculty intervention flags (null = follow the deployment policy).
  allow_recovery           BOOLEAN,
  reverification_required  BOOLEAN NOT NULL DEFAULT false,
  device_label             TEXT,
  started_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at                 TIMESTAMPTZ,
  close_reason             TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Single active session per attempt and per student+deployment: enforced by
-- the database, not by client state.
CREATE UNIQUE INDEX IF NOT EXISTS ux_exam_sessions_active_attempt
  ON exam_sessions(attempt_id) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS ux_exam_sessions_active_student_deployment
  ON exam_sessions(deployment_id, student_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_exam_sessions_deployment_status
  ON exam_sessions(deployment_id, status);
CREATE INDEX IF NOT EXISTS idx_exam_sessions_attempt_id
  ON exam_sessions(attempt_id);
CREATE INDEX IF NOT EXISTS idx_exam_sessions_student_id
  ON exam_sessions(student_id);
CREATE INDEX IF NOT EXISTS idx_exam_sessions_last_heartbeat
  ON exam_sessions(deployment_id, last_heartbeat_at);

DROP TRIGGER IF EXISTS set_exam_sessions_updated_at ON exam_sessions;
CREATE TRIGGER set_exam_sessions_updated_at
  BEFORE UPDATE ON exam_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE exam_sessions ENABLE ROW LEVEL SECURITY;

-- Students may only ever read their own session state.
DROP POLICY IF EXISTS "Students can read own exam_sessions" ON exam_sessions;
CREATE POLICY "Students can read own exam_sessions"
  ON exam_sessions FOR SELECT
  TO authenticated
  USING (student_id = auth.uid());

-- Faculty may read session state only for deployments they are assigned to.
DROP POLICY IF EXISTS "Faculty can read exam_sessions for their offerings" ON exam_sessions;
CREATE POLICY "Faculty can read exam_sessions for their offerings"
  ON exam_sessions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM assessment_deployments ad
      WHERE ad.id = exam_sessions.deployment_id
        AND (
          is_faculty_of_offering(auth.uid(), ad.subject_offering_id)
          OR is_faculty_of_subject(
            auth.uid(),
            (SELECT so.subject_id FROM subject_offerings so
              WHERE so.id = ad.subject_offering_id)
          )
        )
    )
  );

-- No INSERT/UPDATE/DELETE policy for authenticated: session writes go through
-- authorized server actions using the service-role client only.

-- ---------------------------------------------------------------------------
-- 4) exam_events — factual security/session timeline
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exam_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id      UUID NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
  student_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  exam_session_id UUID REFERENCES exam_sessions(id) ON DELETE SET NULL,
  -- Denormalized for authorized realtime filtering + monitor queries.
  deployment_id   UUID REFERENCES assessment_deployments(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL CHECK (event_type IN (
    'exam_started',
    'session_created',
    'session_recovered',
    'session_terminated',
    'fullscreen_entered',
    'fullscreen_exited',
    'tab_hidden',
    'tab_visible',
    'window_blurred',
    'window_focused',
    'page_reloaded',
    'connection_lost',
    'connection_restored',
    'copy_attempt',
    'paste_attempt',
    'context_menu_attempt',
    'concurrent_session_attempt',
    'invalid_session',
    'identity_verified',
    'identity_reverification_required',
    'identity_reverification_failed',
    'pending_sync_started',
    'pending_sync_completed',
    'submission_started',
    'submission_completed',
    'attempt_terminated',
    'faculty_intervention',
    'custom'
  )),
  -- Operational severity. It supports filtering and UI prioritization only;
  -- it never determines academic misconduct.
  severity        TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  metadata        JSONB NOT NULL DEFAULT '{}',
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE exam_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_exam_events_attempt_id ON exam_events(attempt_id);
CREATE INDEX IF NOT EXISTS idx_exam_events_attempt_recorded
  ON exam_events(attempt_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_exam_events_deployment_recorded
  ON exam_events(deployment_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_exam_events_student_id ON exam_events(student_id);
CREATE INDEX IF NOT EXISTS idx_exam_events_severity ON exam_events(severity);
CREATE INDEX IF NOT EXISTS idx_exam_events_session_id ON exam_events(exam_session_id);

-- Faculty: events for attempts in deployments they are assigned to.
DROP POLICY IF EXISTS "Faculty can read exam events for their deployments" ON exam_events;
CREATE POLICY "Faculty can read exam events for their deployments"
  ON exam_events FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM assessment_deployments ad
      WHERE ad.id = exam_events.deployment_id
        AND (
          is_faculty_of_offering(auth.uid(), ad.subject_offering_id)
          OR is_faculty_of_subject(
            auth.uid(),
            (SELECT so.subject_id FROM subject_offerings so
              WHERE so.id = ad.subject_offering_id)
          )
        )
    )
  );

-- Students: their own events only (transparency).
DROP POLICY IF EXISTS "Students can read own exam events" ON exam_events;
CREATE POLICY "Students can read own exam events"
  ON exam_events FOR SELECT
  TO authenticated
  USING (student_id = auth.uid());

-- Writes: service-role only (no INSERT/UPDATE/DELETE policy for authenticated).

-- ---------------------------------------------------------------------------
-- 5) review_notes — recreate the other half of the drifted 20260921
--    migration with the corrected faculty_id column reference.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS review_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id  UUID NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
  author_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  note_type   TEXT NOT NULL DEFAULT 'general'
                CHECK (note_type IN ('general', 'integrity', 'grading', 'exception')),
  content     TEXT NOT NULL,
  is_internal BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE review_notes ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_review_notes_attempt_id ON review_notes(attempt_id);

DROP TRIGGER IF EXISTS set_review_notes_updated_at ON review_notes;
CREATE TRIGGER set_review_notes_updated_at
  BEFORE UPDATE ON review_notes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP POLICY IF EXISTS "Faculty can manage review notes for their deployments" ON review_notes;
CREATE POLICY "Faculty can manage review notes for their deployments"
  ON review_notes FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM exam_attempts ea
      JOIN assessment_deployments ad ON ad.id = ea.deployment_id
      WHERE ea.id = review_notes.attempt_id
        AND is_faculty_of_offering(auth.uid(), ad.subject_offering_id)
    )
  )
  WITH CHECK (author_id = auth.uid());

DROP POLICY IF EXISTS "Students can read non-internal review notes on own attempts" ON review_notes;
CREATE POLICY "Students can read non-internal review notes on own attempts"
  ON review_notes FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM exam_attempts ea
      WHERE ea.id = review_notes.attempt_id
        AND ea.student_id = auth.uid()
        AND review_notes.is_internal = false
    )
  );

-- ---------------------------------------------------------------------------
-- 6) Synchronization idempotency key
-- ---------------------------------------------------------------------------
-- The last operation the server applied to this response. A retried operation
-- carrying the same id is acknowledged without applying twice (lost-ack retry).
ALTER TABLE student_responses ADD COLUMN IF NOT EXISTS last_operation_id UUID;

-- ---------------------------------------------------------------------------
-- 7) Monitor query indexes
-- ---------------------------------------------------------------------------
-- Live Monitor summary counts: filter attempts by deployment + status.
CREATE INDEX IF NOT EXISTS idx_exam_attempts_deployment_status
  ON exam_attempts(deployment_id, status);

-- ---------------------------------------------------------------------------
-- 8) Supabase Realtime (RLS stays enabled; membership is not a policy bypass)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'exam_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.exam_sessions;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'exam_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.exam_events;
  END IF;
END
$$;
