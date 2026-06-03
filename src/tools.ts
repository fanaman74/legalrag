// src/tools.ts
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { embedText } from './embeddings.js';
import { semanticSearch, listDocuments, deleteDocument } from './supabase.js';
import { ingestDocument, parsePdf, parseDocx, parseEml, parseMsg } from './ingest.js';
import type { SourceType } from './types.js';

const sourceTypeEnum = z.enum([
  'olaf_complaint', 'general_court', 'ias_audit', 'ep_discharge',
  'correspondence', 'staff_regulations', 'decision', 'other',
]);

// ─────────────────────────────────────────────
// search_documents
// ─────────────────────────────────────────────
export const searchDocumentsSchema = z.object({
  query:       z.string().describe('Natural language search question or keywords'),
  case_number: z.string().optional().describe('Filter by case number, e.g. T-777/25'),
  source_type: sourceTypeEnum.optional().describe('Filter by document type'),
  threshold:   z.number().min(0).max(1).optional().default(0.60)
    .describe('Minimum similarity score (0–1). Default: 0.60'),
  limit:       z.number().int().min(1).max(20).optional().default(8)
    .describe('Number of results to return. Default: 8'),
});

export async function handleSearchDocuments(
  input: z.infer<typeof searchDocumentsSchema>
): Promise<string> {
  const queryEmbedding = await embedText(input.query);
  const results = await semanticSearch(queryEmbedding, {
    caseNumber: input.case_number,
    sourceType: input.source_type,
    threshold:  input.threshold,
    limit:      input.limit,
  });

  if (results.length === 0) {
    return 'No matching documents found. Try lowering the threshold or broadening your query.';
  }

  return results.map((r, i) => [
    `── Result ${i + 1} ──────────────────────`,
    `File:        ${r.filename}`,
    `Case:        ${r.case_number ?? '—'}`,
    `Type:        ${r.source_type}`,
    `Date:        ${r.document_date ?? '—'}`,
    `Similarity:  ${(r.similarity * 100).toFixed(1)}%`,
    ``,
    r.content,
  ].join('\n')).join('\n\n');
}

// ─────────────────────────────────────────────
// ingest_text
// ─────────────────────────────────────────────
export const ingestTextSchema = z.object({
  filename:      z.string().describe('Document filename or title'),
  content:       z.string().describe('Full plain-text content of the document'),
  source_type:   sourceTypeEnum.describe('Document category'),
  case_number:   z.string().optional().describe('Case or reference number'),
  document_date: z.string().optional().describe('ISO date, e.g. 2025-11-15'),
  language:      z.enum(['en', 'fr']).optional().default('en'),
});

export async function handleIngestText(
  input: z.infer<typeof ingestTextSchema>
): Promise<string> {
  const result = await ingestDocument({
    filename:     input.filename,
    rawText:      input.content,
    sourceType:   input.source_type as SourceType,
    caseNumber:   input.case_number,
    documentDate: input.document_date,
    language:     input.language,
  });
  return result.message;
}

// ─────────────────────────────────────────────
// ingest_file
// ─────────────────────────────────────────────
export const ingestFileSchema = z.object({
  file_path:     z.string().describe('Absolute path to a .pdf, .docx, or .txt file'),
  source_type:   sourceTypeEnum.describe('Document category'),
  case_number:   z.string().optional(),
  document_date: z.string().optional().describe('ISO date, e.g. 2025-11-15'),
  language:      z.enum(['en', 'fr']).optional().default('en'),
});

export async function handleIngestFile(
  input: z.infer<typeof ingestFileSchema>
): Promise<string> {
  const buffer   = await fs.readFile(input.file_path);
  const ext      = path.extname(input.file_path).toLowerCase();
  const filename = path.basename(input.file_path);

  let rawText: string;
  if (ext === '.pdf')       rawText = await parsePdf(buffer);
  else if (ext === '.docx') rawText = await parseDocx(buffer);
  else if (ext === '.eml')  rawText = await parseEml(buffer);
  else if (ext === '.msg')  rawText = await parseMsg(buffer);
  else                      rawText = buffer.toString('utf-8');

  const result = await ingestDocument({
    filename,
    rawText,
    sourceType:   input.source_type as SourceType,
    caseNumber:   input.case_number,
    documentDate: input.document_date,
    language:     input.language,
  });
  return result.message;
}

// ─────────────────────────────────────────────
// list_documents
// ─────────────────────────────────────────────
export async function handleListDocuments(): Promise<string> {
  const docs = await listDocuments();
  if (docs.length === 0) return 'No documents indexed yet.';

  const header = ['ID', 'Filename', 'Type', 'Case', 'Date', 'Chunks'];
  const rows   = docs.map(d => [
    String(d.id),
    d.filename,
    d.source_type,
    d.case_number   ?? '—',
    d.document_date ?? '—',
    String(d.total_chunks),
  ]);

  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map(r => r[i].length))
  );
  const fmt = (row: string[]) =>
    row.map((cell, i) => cell.padEnd(widths[i])).join('  ');

  return [
    fmt(header),
    widths.map(w => '─'.repeat(w)).join('  '),
    ...rows.map(fmt),
    `\nTotal: ${docs.length} document(s)`,
  ].join('\n');
}

// ─────────────────────────────────────────────
// delete_document
// ─────────────────────────────────────────────
export const deleteDocumentSchema = z.object({
  document_id: z.number().int().describe('Document ID from list_documents'),
});

export async function handleDeleteDocument(
  input: z.infer<typeof deleteDocumentSchema>
): Promise<string> {
  await deleteDocument(input.document_id);
  return `Document ${input.document_id} and all its chunks have been deleted.`;
}
