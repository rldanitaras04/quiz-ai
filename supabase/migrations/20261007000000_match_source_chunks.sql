-- Vector retrieval for retrieval-grounded generation (scope §11).
--
-- Embeddings have been written to source_chunks.embedding by material
-- processing since the beginning, but nothing ever queried them: the generate
-- route stuffed every chunk of the faculty-selected materials into the prompt.
-- match_source_chunks is the retrieval half — a cosine search scoped to an
-- explicit set of source materials, so the caller's authorization decides
-- what may be retrieved (the route only ever passes materials it has already
-- verified belong to the caller's offering).
--
-- p_min_similarity keeps near-unrelated chunks out of the prompt; the caller
-- falls back to a bounded chunk read when nothing clears the floor.
--
-- Privilege shape mirrors run_scheduled_maintenance (migration
-- 20261006000000): internal helper, service-role callers only.

CREATE OR REPLACE FUNCTION match_source_chunks(
  p_query_embedding vector(384),
  p_source_material_ids uuid[] DEFAULT NULL,
  p_match_count integer DEFAULT 10,
  p_min_similarity double precision DEFAULT 0.1
)
RETURNS TABLE (
  id uuid,
  source_material_id uuid,
  chunk_index integer,
  content text,
  similarity double precision
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    sc.id,
    sc.source_material_id,
    sc.chunk_index,
    sc.content,
    1::double precision - (sc.embedding <=> p_query_embedding) AS similarity
  FROM source_chunks sc
  WHERE sc.embedding IS NOT NULL
    AND (
      p_source_material_ids IS NULL
      OR sc.source_material_id = ANY (p_source_material_ids)
    )
    AND 1::double precision - (sc.embedding <=> p_query_embedding) >= p_min_similarity
  ORDER BY sc.embedding <=> p_query_embedding
  LIMIT GREATEST(p_match_count, 0);
$$;

REVOKE ALL ON FUNCTION match_source_chunks(vector, uuid[], integer, double precision)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION match_source_chunks(vector, uuid[], integer, double precision)
  TO service_role;
