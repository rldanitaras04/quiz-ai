-- Add 'text' to the source_type CHECK constraint so pasted text content
-- can be stored as a source material (previously only file types were allowed).

ALTER TABLE source_materials
  DROP CONSTRAINT IF EXISTS source_materials_source_type_check;

ALTER TABLE source_materials
  ADD CONSTRAINT source_materials_source_type_check
  CHECK (source_type IN ('pdf', 'docx', 'txt', 'manual', 'file', 'text'));
