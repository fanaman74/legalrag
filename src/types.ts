// src/types.ts

export interface DocumentRecord {
  id?: number;
  filename: string;
  content_hash: string;
  source_type: SourceType;
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
