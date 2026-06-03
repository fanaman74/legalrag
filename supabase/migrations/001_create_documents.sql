-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- ─────────────────────────────────────────────
-- DOCUMENTS  (one row per source file)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id              BIGSERIAL PRIMARY KEY,
  filename        TEXT        NOT NULL,
  content_hash    TEXT        UNIQUE,
  source_type     TEXT,
  case_number     TEXT,
  document_date   DATE,
  language        TEXT        DEFAULT 'en',
  total_chunks    INT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- DOCUMENT CHUNKS  (one row per text segment)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_chunks (
  id              BIGSERIAL PRIMARY KEY,
  document_id     BIGINT      REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index     INT         NOT NULL,
  content         TEXT        NOT NULL,
  embedding       vector(1024),   -- mistralai/mistral-embed = 1024 dims
  token_count     INT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_chunks_document_id
  ON document_chunks (document_id);

CREATE INDEX IF NOT EXISTS idx_documents_case_number
  ON documents (case_number);

CREATE INDEX IF NOT EXISTS idx_documents_source_type
  ON documents (source_type);

-- IVFFlat index for ANN search at scale — run AFTER 100+ chunks are ingested:
-- CREATE INDEX ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ─────────────────────────────────────────────
-- SEMANTIC SEARCH FUNCTION
-- ─────────────────────────────────────────────
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
  SELECT
    dc.id              AS chunk_id,
    dc.document_id,
    d.filename,
    d.case_number,
    d.source_type,
    d.document_date,
    dc.content,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM document_chunks dc
  JOIN documents d ON dc.document_id = d.id
  WHERE
    (1 - (dc.embedding <=> query_embedding)) > match_threshold
    AND (filter_case   IS NULL OR d.case_number  ILIKE '%' || filter_case   || '%')
    AND (filter_source IS NULL OR d.source_type  = filter_source)
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
$$;
