-- Switch embedding dimension from OpenAI (1536) to HuggingFace MiniLM-L6-v2 (384).
-- Existing embeddings are incompatible and will be cleared; source materials
-- will be re-processed automatically when their status is reset to 'pending'.

-- 1. Drop existing embeddings (wrong dimension)
UPDATE source_chunks SET embedding = NULL;
UPDATE questions SET embedding = NULL;

-- 2. Alter column dimensions
ALTER TABLE source_chunks ALTER COLUMN embedding TYPE vector(384);
ALTER TABLE questions ALTER COLUMN embedding TYPE vector(384);

-- 3. Reset source materials so they get re-processed with new embeddings
UPDATE source_materials
  SET processing_status = 'pending',
      processing_error = NULL
  WHERE processing_status = 'ready';
