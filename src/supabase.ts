// src/supabase.ts
import { createClient } from '@supabase/supabase-js';
import type { SearchResult, AnalysisResult } from './types.js';

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

  // Deduplicate: keep best-scoring chunk per document (safety net)
  const seen = new Set<number>();
  return ((data ?? []) as SearchResult[]).filter(r => {
    if (seen.has(r.document_id)) return false;
    seen.add(r.document_id);
    return true;
  });
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

export interface BatchUploadStatus {
  id: string;
  status: 'processing' | 'completed' | 'failed';
  total_files: number;
  successful_count: number;
  failed_count: number;
  errors: Array<{ filename: string; reason: string }> | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export async function createBatchUpload(batch_id: string, total_files: number): Promise<void> {
  const { error } = await supabase
    .from('batch_uploads')
    .insert([{ id: batch_id, total_files }]);

  if (error) throw new Error(`Failed to create batch: ${error.message}`);
}

export async function updateBatchProgress(
  batch_id: string,
  successful_count: number,
  failed_count: number,
  errors: Array<{ filename: string; reason: string }>
): Promise<void> {
  const { error } = await supabase
    .from('batch_uploads')
    .update({
      successful_count,
      failed_count,
      errors,
      status: failed_count === 0 ? 'completed' : 'failed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', batch_id);

  if (error) throw new Error(`Failed to update batch: ${error.message}`);
}

export async function getBatchStatus(batch_id: string): Promise<BatchUploadStatus> {
  const { data, error } = await supabase
    .from('batch_uploads')
    .select('*')
    .eq('id', batch_id)
    .single();

  if (error) throw new Error(`Batch not found: ${error.message}`);
  return data as BatchUploadStatus;
}

export async function storeDocumentAnalysis(
  document_id: number,
  analysis: AnalysisResult
): Promise<void> {
  const { error } = await supabase
    .from('document_analysis')
    .insert([{ document_id, analysis_json: analysis }]);

  if (error) throw new Error(`Failed to store analysis: ${error.message}`);
}

export async function updateDocumentReview(
  document_id: number,
  analysis: AnalysisResult
): Promise<void> {
  const { error } = await supabase
    .from('documents')
    .update({
      document_type: analysis.document_type,
      parties: analysis.parties ?? [],
      key_dates: analysis.key_dates ?? [],
      risks: analysis.risks.map(r => `${r.flag} (${r.severity})`),
      urgency_level: analysis.urgency_level,
      review_status: 'completed',
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', document_id);

  if (error) throw new Error(`Failed to update document review: ${error.message}`);
}
