-- supabase/migrations/004_add_batch_fields.sql
-- Add batch upload support to documents table

-- 1. Add columns to documents table
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS folder_path TEXT,
  ADD COLUMN IF NOT EXISTS document_type TEXT,
  ADD COLUMN IF NOT EXISTS parties JSONB,
  ADD COLUMN IF NOT EXISTS key_dates JSONB,
  ADD COLUMN IF NOT EXISTS risks TEXT[],
  ADD COLUMN IF NOT EXISTS urgency_level TEXT,
  ADD COLUMN IF NOT EXISTS review_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- Create index on review_status for query performance
CREATE INDEX IF NOT EXISTS idx_documents_review_status ON documents(review_status);

-- 2. Create document_analysis table for full review results
CREATE TABLE IF NOT EXISTS document_analysis (
  id SERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  analysis_json JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doc_analysis_doc_id ON document_analysis(document_id);

-- 3. Create batch_uploads table for tracking batch progress
CREATE TABLE IF NOT EXISTS batch_uploads (
  id TEXT PRIMARY KEY,
  status TEXT DEFAULT 'processing',
  total_files INTEGER NOT NULL,
  successful_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  errors JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_batch_uploads_status ON batch_uploads(status);
CREATE INDEX IF NOT EXISTS idx_batch_uploads_created ON batch_uploads(created_at);
