-- ============================================================================
-- Student profile foreign keys (program / year level / section)
-- ============================================================================
--
-- Why: the student dashboard and the profile page embed these rows through
-- PostgREST:
--
--   student_profiles.select('program:programs(code, name), ...')
--
-- PostgREST resolves embeds ONLY through real foreign-key constraints, but the
-- initial schema declared student_profiles.program_id / year_level_id /
-- section_id as bare UUIDs (indexes only, no REFERENCES). Every dashboard load
-- therefore failed deterministically with:
--
--   PGRST200 Could not find a relationship between 'student_profiles' and
--   'programs' in the schema cache
--
-- surfacing as the generic "Failed to load your academic context." error on
-- /student (and a silently empty student block on /profile).
--
-- The columns are nullable, so ON DELETE SET NULL keeps profiles intact when a
-- program/year level/section row is removed. Orphaned references (possible
-- exactly because the constraint never existed) are cleared first so the
-- constraint can always be added.
--
-- Idempotent: safe to run repeatedly.

-- Clear orphans first (the missing FK meant these could drift).
UPDATE student_profiles
SET program_id = NULL
WHERE program_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM programs p WHERE p.id = student_profiles.program_id);

UPDATE student_profiles
SET year_level_id = NULL
WHERE year_level_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM year_levels y WHERE y.id = student_profiles.year_level_id);

UPDATE student_profiles
SET section_id = NULL
WHERE section_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM sections s WHERE s.id = student_profiles.section_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'student_profiles'::regclass
      AND contype = 'f'
      AND conname = 'student_profiles_program_id_fkey'
  ) THEN
    ALTER TABLE student_profiles
      ADD CONSTRAINT student_profiles_program_id_fkey
      FOREIGN KEY (program_id) REFERENCES programs(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'student_profiles'::regclass
      AND contype = 'f'
      AND conname = 'student_profiles_year_level_id_fkey'
  ) THEN
    ALTER TABLE student_profiles
      ADD CONSTRAINT student_profiles_year_level_id_fkey
      FOREIGN KEY (year_level_id) REFERENCES year_levels(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'student_profiles'::regclass
      AND contype = 'f'
      AND conname = 'student_profiles_section_id_fkey'
  ) THEN
    ALTER TABLE student_profiles
      ADD CONSTRAINT student_profiles_section_id_fkey
      FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Make PostgREST pick up the new relationships without waiting for the next
-- automatic schema-cache reload.
NOTIFY pgrst, 'reload schema';
