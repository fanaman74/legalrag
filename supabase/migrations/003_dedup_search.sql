-- Replace search function: return only the best-matching chunk per document
CREATE OR REPLACE FUNCTION search_document_chunks(
  query_embedding   vector(1024),
  filter_case       TEXT     DEFAULT NULL,
  filter_source     TEXT     DEFAULT NULL,
  match_threshold   FLOAT    DEFAULT 0.60,
  match_count       INT      DEFAULT 8
)
RETURNS TABLE (
  chunk_id        BIGINT,
  document_id     BIGINT,
  filename        TEXT,
  case_number     TEXT,
  source_type     TEXT,
  document_date   DATE,
  content         TEXT,
  similarity      FLOAT
)
LANGUAGE SQL
SECURITY DEFINER
AS $$
  SELECT chunk_id, document_id, filename, case_number, source_type, document_date, content, similarity
  FROM (
    SELECT DISTINCT ON (dc.document_id)
      dc.id                                      AS chunk_id,
      dc.document_id,
      d.filename,
      d.case_number,
      d.source_type,
      d.document_date,
      dc.content,
      1 - (dc.embedding <=> query_embedding)    AS similarity
    FROM document_chunks dc
    JOIN documents d ON dc.document_id = d.id
    WHERE
      (1 - (dc.embedding <=> query_embedding)) > match_threshold
      AND (filter_case   IS NULL OR d.case_number ILIKE '%' || filter_case   || '%')
      AND (filter_source IS NULL OR d.source_type = filter_source)
    ORDER BY dc.document_id, dc.embedding <=> query_embedding  -- best chunk per doc
  ) best
  ORDER BY similarity DESC
  LIMIT match_count;
$$;
