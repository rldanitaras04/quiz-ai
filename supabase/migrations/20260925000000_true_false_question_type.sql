-- ============================================================================
-- True / False question type (includes Modified True or False statements)
-- Idempotent: safe to run multiple times.
-- ============================================================================

-- questions.question_type
ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_question_type_check;
ALTER TABLE questions
  ADD CONSTRAINT questions_question_type_check
  CHECK (question_type IN ('multiple_choice', 'identification', 'true_false'));

-- question_bank.question_type
ALTER TABLE question_bank DROP CONSTRAINT IF EXISTS question_bank_question_type_check;
ALTER TABLE question_bank
  ADD CONSTRAINT question_bank_question_type_check
  CHECK (question_type IN ('multiple_choice', 'identification', 'true_false'));

-- assessments.assessment_type (also stores question-type-like values in this app)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assessments_assessment_type_check'
  ) THEN
    ALTER TABLE assessments DROP CONSTRAINT assessments_assessment_type_check;
  END IF;
END $$;

ALTER TABLE assessments
  ADD CONSTRAINT assessments_assessment_type_check
  CHECK (assessment_type IN (
    'quiz', 'exam', 'assignment', 'custom',
    'multiple_choice', 'identification', 'true_false'
  ));
