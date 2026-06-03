-- Add folder column to track parent directory hierarchy
ALTER TABLE documents ADD COLUMN IF NOT EXISTS folder TEXT;

CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents (folder);
