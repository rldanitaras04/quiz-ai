-- ============================================================================
-- Topics + Question Bank (faculty: AI / manual / bank selection, by topic)
-- ============================================================================
-- Idempotent: safe to run multiple times.

-- ----------------------------------------------------------------------------
-- Helpers: faculty check at subject level
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_faculty_of_subject(uid UUID, subject_id_val UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER STABLE
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM faculty_assignments fa
    JOIN subject_offerings so ON so.id = fa.subject_offering_id
    WHERE fa.faculty_id = uid
      AND so.subject_id = subject_id_val
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- Topics — per subject (faculty-scoped reusable categories)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS topics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(subject_id, title)
);

DROP TRIGGER IF EXISTS set_topics_updated_at ON topics;
CREATE TRIGGER set_topics_updated_at BEFORE UPDATE ON topics
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_topics_subject_id ON topics(subject_id);
CREATE INDEX IF NOT EXISTS idx_topics_created_by ON topics(created_by);

ALTER TABLE topics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Faculty can manage topics for assigned subjects" ON topics;
CREATE POLICY "Faculty can manage topics for assigned subjects"
  ON topics FOR ALL TO authenticated
  USING (is_faculty_of_subject(auth.uid(), subject_id) OR is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Authenticated can read topics" ON topics;
CREATE POLICY "Authenticated can read topics"
  ON topics FOR SELECT TO authenticated
  USING (true);

-- Back-compat: source_materials.topic_id should reference topics
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'source_materials_topic_id_fkey'
  ) THEN
    ALTER TABLE source_materials
      ADD CONSTRAINT source_materials_topic_id_fkey
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_source_materials_topic_id ON source_materials(topic_id);

-- ----------------------------------------------------------------------------
-- Questions: add topic_id for per-question categorization
-- ----------------------------------------------------------------------------
ALTER TABLE questions ADD COLUMN IF NOT EXISTS topic_id UUID REFERENCES topics(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_questions_topic_id ON questions(topic_id);

-- ----------------------------------------------------------------------------
-- assessment_topics — optional link for TOS / report by topic
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assessment_topics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  assessment_version_id UUID NOT NULL REFERENCES assessment_versions(id) ON DELETE CASCADE,
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  weight NUMERIC,
  item_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(assessment_version_id, topic_id)
);
CREATE INDEX IF NOT EXISTS idx_assessment_topics_version_id ON assessment_topics(assessment_version_id);
CREATE INDEX IF NOT EXISTS idx_assessment_topics_topic_id ON assessment_topics(topic_id);
ALTER TABLE assessment_topics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Faculty can manage assessment_topics" ON assessment_topics;
CREATE POLICY "Faculty can manage assessment_topics"
  ON assessment_topics FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM assessment_versions av
      JOIN assessments a ON a.id = av.assessment_id
      JOIN subject_offerings so ON so.id = a.subject_offering_id
      WHERE av.id = assessment_topics.assessment_version_id
        AND (is_faculty_of_offering(auth.uid(), a.subject_offering_id) OR is_faculty_of_subject(auth.uid(), so.subject_id) OR is_super_admin(auth.uid()))
    )
  );
DROP POLICY IF EXISTS "Authenticated can read assessment_topics" ON assessment_topics;
CREATE POLICY "Authenticated can read assessment_topics"
  ON assessment_topics FOR SELECT TO authenticated
  USING (true);

-- ----------------------------------------------------------------------------
-- Question bank (canonical reusable items, per subject, grouped by topic)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS question_bank (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
  question_type TEXT NOT NULL CHECK (question_type IN ('multiple_choice', 'identification')),
  question_text TEXT NOT NULL,
  difficulty TEXT DEFAULT 'moderate' CHECK (difficulty IN ('easy', 'moderate', 'difficult')),
  bloom_level TEXT DEFAULT 'understand' CHECK (bloom_level IN ('remember', 'understand', 'apply', 'analyze', 'evaluate', 'create')),
  points INTEGER DEFAULT 1 CHECK (points > 0),
  source_question_id UUID REFERENCES questions(id) ON DELETE SET NULL,
  source_metadata JSONB DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived', 'draft')),
  usage_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
DROP TRIGGER IF EXISTS set_question_bank_updated_at ON question_bank;
CREATE TRIGGER set_question_bank_updated_at BEFORE UPDATE ON question_bank
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE INDEX IF NOT EXISTS idx_question_bank_subject_id ON question_bank(subject_id);
CREATE INDEX IF NOT EXISTS idx_question_bank_topic_id ON question_bank(topic_id);
CREATE INDEX IF NOT EXISTS idx_question_bank_status ON question_bank(status);
CREATE INDEX IF NOT EXISTS idx_question_bank_created_by ON question_bank(created_by);
ALTER TABLE question_bank ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Faculty can manage question_bank for assigned subjects" ON question_bank;
CREATE POLICY "Faculty can manage question_bank for assigned subjects"
  ON question_bank FOR ALL TO authenticated
  USING (is_faculty_of_subject(auth.uid(), subject_id) OR is_super_admin(auth.uid()));
DROP POLICY IF EXISTS "Authenticated can read question_bank" ON question_bank;
CREATE POLICY "Authenticated can read question_bank"
  ON question_bank FOR SELECT TO authenticated
  USING (true);

CREATE TABLE IF NOT EXISTS question_bank_choices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bank_question_id UUID NOT NULL REFERENCES question_bank(id) ON DELETE CASCADE,
  choice_key TEXT NOT NULL,
  choice_text TEXT NOT NULL,
  position INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(bank_question_id, choice_key)
);
CREATE INDEX IF NOT EXISTS idx_qb_choices_bank_id ON question_bank_choices(bank_question_id);
ALTER TABLE question_bank_choices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Faculty can manage qb choices" ON question_bank_choices;
CREATE POLICY "Faculty can manage qb choices"
  ON question_bank_choices FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM question_bank qb
      WHERE qb.id = question_bank_choices.bank_question_id
        AND (is_faculty_of_subject(auth.uid(), qb.subject_id) OR is_super_admin(auth.uid()))
    )
  );
DROP POLICY IF EXISTS "Authenticated can read qb choices" ON question_bank_choices;
CREATE POLICY "Authenticated can read qb choices"
  ON question_bank_choices FOR SELECT TO authenticated
  USING (true);

CREATE TABLE IF NOT EXISTS question_bank_answer_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bank_question_id UUID UNIQUE NOT NULL REFERENCES question_bank(id) ON DELETE CASCADE,
  correct_choice_id UUID REFERENCES question_bank_choices(id) ON DELETE SET NULL,
  canonical_answer TEXT,
  accepted_answers JSONB DEFAULT '[]'::jsonb,
  scoring_config JSONB DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
DROP TRIGGER IF EXISTS set_question_bank_answer_keys_updated_at ON question_bank_answer_keys;
CREATE TRIGGER set_question_bank_answer_keys_updated_at BEFORE UPDATE ON question_bank_answer_keys
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE INDEX IF NOT EXISTS idx_qb_answer_keys_bank_id ON question_bank_answer_keys(bank_question_id);
ALTER TABLE question_bank_answer_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Faculty can manage qb answer_keys" ON question_bank_answer_keys;
CREATE POLICY "Faculty can manage qb answer_keys"
  ON question_bank_answer_keys FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM question_bank qb
      WHERE qb.id = question_bank_answer_keys.bank_question_id
        AND (is_faculty_of_subject(auth.uid(), qb.subject_id) OR is_super_admin(auth.uid()))
    )
  );
-- No student SELECT on answer keys (never exposed to students via RLS)
DROP POLICY IF EXISTS "Faculty can read qb answer_keys" ON question_bank_answer_keys;
CREATE POLICY "Faculty can read qb answer_keys"
  ON question_bank_answer_keys FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM question_bank qb
      WHERE qb.id = question_bank_answer_keys.bank_question_id
        AND (is_faculty_of_subject(auth.uid(), qb.subject_id) OR is_super_admin(auth.uid()))
    )
  );
