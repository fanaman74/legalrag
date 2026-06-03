// src/supabase.ts
import { createClient } from '@supabase/supabase-js';
import type { SearchResult } from './types.js';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function upsertDocument(doc: {
  filename: string;
  content_hash: string;
  source_type: string;
  folder?: string;
  case_number?: string;
  document_date?: string;
  language?: string;
  total_chunks: number;
}): Promise<number> {
  const { data, error } = await supabase
    .from('documents')
    .upsert(doc, { onConflict: 'content_hash' })
    .select('id')
    .single();

  if (error) throw new Error(`upsertDocument failed: ${error.message}`);
  return (data as { id: number }).id;
}

export async function insertChunks(chunks: Array<{
  document_id: number;
  chunk_index: number;
  content: string;
  embedding: number[];
  token_count: number;
}>): Promise<void> {
  const batchSize = 50;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const { error } = await supabase.from('document_chunks').insert(batch);
    if (error) throw new Error(`insertChunks batch ${i} failed: ${error.message}`);
  }
}

export async function semanticSearch(
  queryEmbedding: number[],
  options: {
    caseNumber?: string;
    sourceType?: string;
    threshold?: number;
    limit?: number;
  } = {}
): Promise<SearchResult[]> {
  const { data, error } = await supabase.rpc('search_document_chunks', {
    query_embedding: queryEmbedding,
    filter_case:     options.caseNumber  ?? null,
    filter_source:   options.sourceType  ?? null,
    match_threshold: options.threshold   ?? 0.60,
    match_count:     options.limit       ?? 8,
  });

  if (error) throw new Error(`semanticSearch failed: ${error.message}`);
  return (data ?? []) as SearchResult[];
}

export async function listDocuments(): Promise<Array<{
  id: number;
  filename: string;
  source_type: string;
  folder: string | null;
  case_number: string | null;
  document_date: string | null;
  total_chunks: number;
  created_at: string;
}>> {
  const { data, error } = await supabase
    .from('documents')
    .select('id, filename, source_type, folder, case_number, document_date, total_chunks, created_at')
    .order('created_at', { ascending: false });

  if (error) throw new Error(`listDocuments failed: ${error.message}`);
  return (data ?? []) as Array<{
    id: number;
    filename: string;
    source_type: string;
    folder: string | null;
    case_number: string | null;
    document_date: string | null;
    total_chunks: number;
    created_at: string;
  }>;
}

export async function getDocumentContent(documentId: number): Promise<{
  filename: string;
  source_type: string;
  folder: string | null;
  case_number: string | null;
  document_date: string | null;
  content: string;
} | null> {
  const { data: doc, error: docErr } = await supabase
    .from('documents')
    .select('filename, source_type, folder, case_number, document_date')
    .eq('id', documentId)
    .single();

  if (docErr || !doc) return null;

  const { data: chunks, error: chunkErr } = await supabase
    .from('document_chunks')
    .select('content, chunk_index')
    .eq('document_id', documentId)
    .order('chunk_index');

  if (chunkErr) return null;

  return {
    ...(doc as any),
    content: (chunks ?? []).map((c: any) => c.content).join('\n\n'),
  };
}

export async function deleteDocument(documentId: number): Promise<void> {
  const { error } = await supabase
    .from('documents')
    .delete()
    .eq('id', documentId);

  if (error) throw new Error(`deleteDocument failed: ${error.message}`);
}
