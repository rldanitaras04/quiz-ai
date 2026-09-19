-- ============================================================================
-- SEED DATA
-- Run this AFTER applying the initial migration
-- ============================================================================

-- Create an admin user via Supabase Auth first (register via the app or use dashboard)
-- Then run this to promote them to super_admin:
-- Replace the UUID with your actual user ID from auth.users

-- Example: Promote a user to admin
-- INSERT INTO user_roles (user_id, role)
-- VALUES ('YOUR_USER_UUID_HERE', 'super_admin');

-- Insert default academic year
INSERT INTO academic_years (name, starts_on, ends_on, is_active)
VALUES ('2026-2027', '2026-06-01', '2027-05-31', true)
ON CONFLICT DO NOTHING;

-- Insert default semesters
INSERT INTO semesters (academic_year_id, name, starts_on, ends_on, is_active)
SELECT id, '1st Semester', '2026-06-01', '2026-10-31', true
FROM academic_years WHERE name = '2026-2027'
ON CONFLICT DO NOTHING;

INSERT INTO semesters (academic_year_id, name, starts_on, ends_on, is_active)
SELECT id, '2nd Semester', '2027-01-01', '2027-05-31', true
FROM academic_years WHERE name = '2026-2027'
ON CONFLICT DO NOTHING;

-- Insert default year levels
INSERT INTO year_levels (name, sort_order) VALUES
  ('1st Year', 1),
  ('2nd Year', 2),
  ('3rd Year', 3),
  ('4th Year', 4)
ON CONFLICT DO NOTHING;

-- Insert default programs
INSERT INTO programs (code, name) VALUES
  ('BSIT', 'Bachelor of Science in Information Technology'),
  ('BSBA', 'Bachelor of Science in Business Administration'),
  ('BSED', 'Bachelor of Secondary Education'),
  ('BSN', 'Bachelor of Science in Nursing')
ON CONFLICT DO NOTHING;
