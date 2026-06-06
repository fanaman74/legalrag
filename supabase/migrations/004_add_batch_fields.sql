-- supabase/migrations/004_add_batch_fields.sql
-- Add batch upload support to documents table

-- 1. Add columns to documents table
ALTER TABLE documents ADD COLUMN IF NOT EXISTS (
  folder_path TEXT,
  document_type TEXT,
  parties JSONB,
  key_dates JSONB,
  risks TEXT[],
  urgency_level TEXT,
  review_status TEXT DEFAULT 'pending',
  reviewed_at TIMESTAMP
);

-- 2. Create document_analysis table for full review results
CREATE TABLE IF NOT EXISTS document_analysis (
  id SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  analysis_json JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doc_analysis_doc_id ON document_analysis(document_id);

-- 3. Create batch_uploads table for tracking batch progress
CREATE TABLE IF NOT EXISTS batch_uploads (
  id TEXT PRIMARY KEY,
  status TEXT DEFAULT 'processing', -- processing, completed, failed
  total_files INTEGER NOT NULL,
  successful_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  errors JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_batch_uploads_created ON batch_uploads(created_at);
