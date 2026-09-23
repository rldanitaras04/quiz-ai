-- ============================================================================
-- Exam Events & Integrity Signals
-- Stores client-reported integrity signals (tab switches, fullscreen exits,
-- verification failures) for faculty review. These are signals, not
-- automatic findings — faculty must interpret them in context.
-- ============================================================================

CREATE TABLE IF NOT EXISTS exam_events (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  attempt_id    UUID NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
  student_id    UUID NOT NULL REFERENCES profiles(id),
  event_type    TEXT NOT NULL CHECK (event_type IN (
    'tab_blur',
    'tab_focus',
    'window_blur',
    'window_focus',
    'fullscreen_exit',
    'fullscreen_enter',
    'verification_failed',
    'verification_passed',
    'copy_attempt',
    'paste_attempt',
    'session_resume',
    'device_change',
    'network_disconnect',
    'network_reconnect',
    'suspicious_activity',
    'custom'
  )),
  severity      TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  metadata      JSONB DEFAULT '{}',
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE exam_events ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_exam_events_attempt_id ON exam_events(attempt_id);
CREATE INDEX IF NOT EXISTS idx_exam_events_student_id ON exam_events(student_id);
CREATE INDEX IF NOT EXISTS idx_exam_events_attempt_type ON exam_events(attempt_id, event_type);
CREATE INDEX IF NOT EXISTS idx_exam_events_severity ON exam_events(severity);

-- Faculty: read events for attempts in their deployments
CREATE POLICY "Faculty can read exam events for their deployments"
  ON exam_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM exam_attempts ea
      JOIN assessment_deployments ad ON ad.id = ea.deployment_id
      JOIN faculty_assignments fa ON fa.subject_offering_id = ad.subject_offering_id
      WHERE ea.id = exam_events.attempt_id
        AND fa.user_id = auth.uid()
    )
  );

-- Students: read own events (for transparency)
CREATE POLICY "Students can read own exam events"
  ON exam_events FOR SELECT
  USING (student_id = auth.uid());

-- System (service-role) can insert events
-- Authenticated role has no INSERT grant — events are inserted server-side only.

-- ============================================================================
-- Faculty Review Notes
-- ============================================================================

CREATE TABLE IF NOT EXISTS review_notes (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  attempt_id    UUID NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
  author_id     UUID NOT NULL REFERENCES profiles(id),
  note_type     TEXT NOT NULL DEFAULT 'general' CHECK (note_type IN ('general', 'integrity', 'grading', 'exception')),
  content       TEXT NOT NULL,
  is_internal   BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE review_notes ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_review_notes_attempt_id ON review_notes(attempt_id);

-- Faculty: full CRUD on notes for their deployments
CREATE POLICY "Faculty can manage review notes for their deployments"
  ON review_notes FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM exam_attempts ea
      JOIN assessment_deployments ad ON ad.id = ea.deployment_id
      JOIN faculty_assignments fa ON fa.subject_offering_id = ad.subject_offering_id
      WHERE ea.id = review_notes.attempt_id
        AND fa.user_id = auth.uid()
    )
  )
  WITH CHECK (
    author_id = auth.uid()
  );

-- Students: read non-internal notes on their own attempts
CREATE POLICY "Students can read non-internal review notes on own attempts"
  ON review_notes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM exam_attempts ea
      WHERE ea.id = review_notes.attempt_id
        AND ea.student_id = auth.uid()
        AND review_notes.is_internal = FALSE
    )
  );
