// src/ingest.ts
import crypto from 'crypto';
import { chunkText } from './chunking.js';
import { embedDocument } from './embeddings.js';
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
  const { upsertDocument, insertChunks } = await import('./supabase.js');

  const contentHash = crypto.createHash('sha256').update(rawText).digest('hex');
  const chunks      = chunkText(rawText);
  console.error(`[ingest] ${filename}: ${chunks.length} chunks`);

  const documentId = await upsertDocument({
    filename,
    content_hash:  contentHash,
    source_type:   sourceType,
    case_number:   caseNumber,
    document_date: documentDate,
    language:      language ?? 'en',
    total_chunks:  chunks.length,
  });

  console.error(`[ingest] Embedding ${chunks.length} chunks...`);
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

export async function parseEml(buffer: Buffer): Promise<string> {
  const { simpleParser } = await import('mailparser');
  const parsed = await simpleParser(buffer);

  const fromObj = parsed.from;
  const toObj   = parsed.to;
  const from    = Array.isArray(fromObj) ? (fromObj[0]?.text ?? '') : (fromObj?.text ?? '');
  const to      = Array.isArray(toObj)   ? toObj.map(a => a.text).join(', ') : (toObj?.text ?? '');
  const date    = parsed.date ? parsed.date.toISOString().slice(0, 10) : '';
  const subject = parsed.subject       ?? '';

  // Prefer plain text; strip HTML tags if only HTML is available
  let body = parsed.text ?? '';
  if (!body && parsed.html) {
    body = parsed.html.replace(/<[^>]*>/g, ' ').replace(/\s{2,}/g, ' ').trim();
  }

  return [
    from    ? `From: ${from}`       : '',
    to      ? `To: ${to}`           : '',
    date    ? `Date: ${date}`       : '',
    subject ? `Subject: ${subject}` : '',
    '',
    body,
  ].filter((line, idx) => idx >= 4 || line !== '').join('\n');
}

export async function parseMsg(buffer: Buffer): Promise<string> {
  const MsgReaderModule = await import('@kenjiuno/msgreader');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const MsgReader = (MsgReaderModule as any).default ?? MsgReaderModule;
  const reader = new MsgReader(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  const data   = reader.getFileData();

  const from    = (data as any).senderEmail ?? (data as any).senderName ?? '';
  const to      = ((data as any).recipients ?? [])
    .map((r: any) => r.email ?? r.name ?? '')
    .filter(Boolean)
    .join(', ');
  const subject = (data as any).subject ?? '';
  const body    = (data as any).body    ?? '';

  return [
    from    ? `From: ${from}`       : '',
    to      ? `To: ${to}`           : '',
    subject ? `Subject: ${subject}` : '',
    '',
    body,
  ].filter((line, idx) => idx >= 3 || line !== '').join('\n');
}
