// src/types.ts

/** Supported language codes for documents and metadata. */
export type Language = 'en' | 'fr';

/** Structured metadata for a legal document in the knowledge base. */
export interface DocumentRecord {
  id?: number;
  filename: string;
  content_hash: string;
  source_type: SourceType;
  folder?: string;
  case_number?: string;
  document_date?: string;
  language?: Language;
  total_chunks?: number;
}

/** Text chunk extracted from a document with its embedding vector. */
export interface ChunkRecord {
  document_id: number;
  chunk_index: number;
  content: string;
  embedding: number[];
  token_count: number;
}

/** Search result containing a matching chunk and associated document metadata. */
export interface SearchResult {
  chunk_id: number;
  document_id: number;
  filename: string;
  case_number: string | null;
  source_type: SourceType;
  document_date: string | null;
  content: string;
  similarity: number;
}

export type SourceType =
  | 'olaf_complaint'
  | 'general_court'
  | 'ias_audit'
  | 'ep_discharge'
  | 'correspondence'
  | 'staff_regulations'
  | 'decision'
  | 'other';

/** Batch ingestion request for processing multiple documents. */
export interface BatchRequest {
  batch_id: string;
  total_files: number;
  source_type?: SourceType;
  case_number?: string;
  language?: Language;
}

/** Real-time progress updates during batch processing. */
export interface BatchProgress {
  type: 'progress' | 'complete';
  batch_id: string;
  file_index?: number;
  total_files?: number;
  filename?: string;
  status?: 'processing' | 'success' | 'failed';
  document_id?: number;
  error?: string | null;
  successful?: number;
  failed?: number;
  errors?: Array<{ filename: string; reason: string }>;
}

/** AI-generated analysis and risk assessment for a legal document. */
export interface AnalysisResult {
  document_type: string;
  parties: string[];
  key_dates: string[];
  risks: Array<{ flag: string; severity: string }>;
  urgency_level: string;
  summary?: string;
  ai_model: string;
  reviewed_at: string;
}

/** Document record enriched with analysis results and metadata. */
export interface DocumentWithAnalysis {
  id: number;
  filename: string;
  source_type: SourceType;
  folder_path?: string;
  document_type?: string;
  parties?: string[];
  key_dates?: string[];
  risks?: string[];
  urgency_level?: string;
  review_status: string;
  reviewed_at?: string;
  analysis?: AnalysisResult;
}
