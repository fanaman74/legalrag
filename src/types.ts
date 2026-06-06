// src/types.ts

export interface DocumentRecord {
  id?: number;
  filename: string;
  content_hash: string;
  source_type: SourceType;
  folder?: string;
  case_number?: string;
  document_date?: string;
  language?: 'en' | 'fr';
  total_chunks?: number;
}

export interface ChunkRecord {
  document_id: number;
  chunk_index: number;
  content: string;
  embedding: number[];
  token_count: number;
}

export interface SearchResult {
  chunk_id: number;
  document_id: number;
  filename: string;
  case_number: string | null;
  source_type: string;
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

export interface BatchRequest {
  batch_id: string;
  total_files: number;
  source_type?: SourceType;
  case_number?: string;
  language?: 'en' | 'fr';
}

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
