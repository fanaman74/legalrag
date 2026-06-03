// src/ingest.ts
import crypto from 'crypto';
import { chunkText } from './chunking.js';
import { embedDocument } from './embeddings.js';
import { upsertDocument, insertChunks } from './supabase.js';
import type { SourceType } from './types.js';

export interface IngestOptions {
  filename: string;
  rawText: string;
  sourceType: SourceType;
  caseNumber?: string;
  documentDate?: string;
  language?: 'en' | 'fr';
}

export interface IngestResult {
  documentId: number;
  chunksCreated: number;
  skipped: boolean;
  message: string;
}

export async function ingestDocument(opts: IngestOptions): Promise<IngestResult> {
  const { filename, rawText, sourceType, caseNumber, documentDate, language } = opts;

  const contentHash = crypto.createHash('sha256').update(rawText).digest('hex');
  const chunks      = chunkText(rawText);
  console.log(`[ingest] ${filename}: ${chunks.length} chunks`);

  const documentId = await upsertDocument({
    filename,
    content_hash:  contentHash,
    source_type:   sourceType,
    case_number:   caseNumber,
    document_date: documentDate,
    language:      language ?? 'en',
    total_chunks:  chunks.length,
  });

  console.log(`[ingest] Embedding ${chunks.length} chunks...`);
  const chunkRecords = await Promise.all(
    chunks.map(async (chunk, idx) => ({
      document_id: documentId,
      chunk_index: idx,
      content:     chunk.content,
      embedding:   await embedDocument(chunk.content),
      token_count: chunk.tokenCount,
    }))
  );

  await insertChunks(chunkRecords);

  return {
    documentId,
    chunksCreated: chunks.length,
    skipped:       false,
    message:       `Successfully ingested "${filename}" as ${chunks.length} chunks (document ID: ${documentId})`,
  };
}

export async function parsePdf(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await parser.getText();
  return result.text;
}

export async function parseDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  const result  = await mammoth.extractRawText({ buffer });
  return result.value;
}
