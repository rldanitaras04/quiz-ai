-- enrollments.updated_at: the faculty add/remove/re-enroll actions already
-- write this column, but the table never had it — PostgREST rejects the update
-- with `column enrollments.updated_at does not exist`, so withdraw and
-- re-enroll were failing at the database layer. Add the column (matching every
-- other managed table) plus the standard updated_at trigger.

ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

DROP TRIGGER IF EXISTS set_enrollments_updated_at ON enrollments;
CREATE TRIGGER set_enrollments_updated_at BEFORE UPDATE ON enrollments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
