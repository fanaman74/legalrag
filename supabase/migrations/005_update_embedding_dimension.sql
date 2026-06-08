-- supabase/migrations/005_update_embedding_dimension.sql
-- Update embedding dimension from 1024 (mistralai) to 384 (Xenova/all-MiniLM-L6-v2)

-- Drop the old embedding column constraint and recreate with new dimension
ALTER TABLE document_chunks DROP COLUMN IF EXISTS embedding;
ALTER TABLE document_chunks ADD COLUMN embedding vector(384);  -- Xenova/all-MiniLM-L6-v2 = 384 dims

-- Update the semantic search function comment if needed
COMMENT ON COLUMN document_chunks.embedding IS 'Text embedding vector (384 dimensions) using Xenova/all-MiniLM-L6-v2 model';
