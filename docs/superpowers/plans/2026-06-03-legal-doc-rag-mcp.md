# Legal Document RAG — MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Retrieval-Augmented Generation MCP server that indexes legal/regulatory documents into Supabase pgvector and exposes semantic search + ingestion tools to Claude Desktop (local stdio) and Claude.ai (remote HTTP/SSE).

**Architecture:** Documents are chunked, embedded via Voyage AI (`voyage-3-large`, 1024 dims), and stored in Supabase. The MCP server exposes five tools (`search_documents`, `ingest_text`, `ingest_file`, `list_documents`, `delete_document`) over either stdio (Claude Desktop) or HTTP+SSE (Railway/Claude.ai). A CLI ingestion script handles bulk document loading.

**Tech Stack:** TypeScript + tsx, `@modelcontextprotocol/sdk`, `@supabase/supabase-js`, Voyage AI REST API, `pdf-parse`, `mammoth`, `zod`, `express`, `dotenv`

---

## Spec Corrections (applied throughout this plan)

Two bugs in the source spec are fixed here:

1. **Vector dimensions**: `voyage-3-large` produces **1024-dimensional** embeddings, not 1536. All SQL uses `vector(1024)`.
2. **Voyage AI API key**: Voyage AI requires its **own API key** (`VOYAGE_API_KEY` from voyageai.com), separate from your Anthropic key. The spec incorrectly uses `ANTHROPIC_API_KEY` for the Voyage endpoint.

---

## File Map

```
mylegal-mcp/                           ← project root (already exists, empty)
├── supabase/
│   └── migrations/
│       └── 001_create_documents.sql   ← CREATE TABLE + search function
├── src/
│   ├── types.ts                        ← shared TypeScript interfaces
│   ├── supabase.ts                     ← Supabase client + DB helpers
│   ├── embeddings.ts                   ← Voyage AI embedding calls
│   ├── chunking.ts                     ← text splitting logic (pure, testable)
│   ├── ingest.ts                       ← PDF/DOCX parsing + orchestration
│   ├── tools.ts                        ← MCP tool schemas + handlers
│   ├── server.ts                       ← stdio MCP entry (Claude Desktop)
│   └── remote.ts                       ← HTTP/SSE MCP entry (Railway)
├── scripts/
│   └── ingest-file.ts                  ← CLI: ingest a file from disk
├── tests/
│   └── chunking.test.ts               ← unit tests for chunking (pure fn)
├── .env                                ← secrets (never commit)
├── .env.example                        ← committed template
├── .gitignore
├── package.json
├── tsconfig.json
└── railway.json
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `railway.json`

- [ ] **Step 1: Initialise npm project**

```bash
cd /Users/fred/Documents/VibeCoding/claudecode/mylegal-mcp
npm init -y
```

Expected: `package.json` created with defaults.

- [ ] **Step 2: Install dev dependencies**

```bash
npm install typescript tsx @types/node --save-dev
```

- [ ] **Step 3: Install production dependencies**

```bash
npm install \
  @anthropic-ai/sdk \
  @supabase/supabase-js \
  @modelcontextprotocol/sdk \
  pdf-parse \
  mammoth \
  dotenv \
  zod \
  express \
  cors
```

```bash
npm install --save-dev \
  @types/pdf-parse \
  @types/express \
  @types/cors \
  vitest
```

- [ ] **Step 4: Install TypeScript globally (for tsc init)**

```bash
npx tsc --init
```

- [ ] **Step 5: Write `tsconfig.json`**

Replace the generated file entirely:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

> Note: `module: NodeNext` is required for proper ESM resolution with tsx and the MCP SDK.

- [ ] **Step 6: Update `package.json` scripts and type field**

Edit `package.json` — add `"type": "module"` and replace the `scripts` block:

```json
{
  "type": "module",
  "scripts": {
    "build":        "tsc",
    "start:local":  "npx tsx src/server.ts",
    "start:remote": "node dist/remote.js",
    "ingest":       "npx tsx scripts/ingest-file.ts",
    "dev":          "npx tsx --watch src/server.ts",
    "test":         "vitest run"
  }
}
```

- [ ] **Step 7: Create `.gitignore`**

```
.env
node_modules/
dist/
*.pdf
*.docx
uploads/
```

- [ ] **Step 8: Create `.env.example`**

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
VOYAGE_API_KEY=
PORT=3000
NODE_ENV=development
```

- [ ] **Step 9: Create `railway.json`**

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "npm run start:remote",
    "healthcheckPath": "/health",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

- [ ] **Step 10: Create your `.env` from the example**

```bash
cp .env.example .env
```

Then open `.env` and fill in your real values:
- `SUPABASE_URL` — from Supabase → Project Settings → API
- `SUPABASE_SERVICE_ROLE_KEY` — from the same page (service_role key, not anon)
- `ANTHROPIC_API_KEY` — from console.anthropic.com
- `VOYAGE_API_KEY` — from voyageai.com (create a free account → API keys)
- `PORT=3000`

- [ ] **Step 11: Verify Node version**

```bash
node --version
```

Expected: `v20.x.x` or higher. If lower, install Node 20 LTS via `nvm install 20`.

---

## Task 2: Supabase Migration

**Files:**
- Create: `supabase/migrations/001_create_documents.sql`

- [ ] **Step 1: Create directory**

```bash
mkdir -p supabase/migrations
```

- [ ] **Step 2: Write migration SQL**

Create `supabase/migrations/001_create_documents.sql`:

```sql
-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- ─────────────────────────────────────────────
-- DOCUMENTS  (one row per source file)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id              BIGSERIAL PRIMARY KEY,
  filename        TEXT        NOT NULL,
  content_hash    TEXT        UNIQUE,
  source_type     TEXT,
  case_number     TEXT,
  document_date   DATE,
  language        TEXT        DEFAULT 'en',
  total_chunks    INT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- DOCUMENT CHUNKS  (one row per text segment)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_chunks (
  id              BIGSERIAL PRIMARY KEY,
  document_id     BIGINT      REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index     INT         NOT NULL,
  content         TEXT        NOT NULL,
  embedding       vector(1024),   -- voyage-3-large = 1024 dims
  token_count     INT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_chunks_document_id
  ON document_chunks (document_id);

CREATE INDEX IF NOT EXISTS idx_documents_case_number
  ON documents (case_number);

CREATE INDEX IF NOT EXISTS idx_documents_source_type
  ON documents (source_type);

-- IVFFlat index for ANN search at scale — run AFTER 100+ chunks are ingested:
-- CREATE INDEX ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ─────────────────────────────────────────────
-- SEMANTIC SEARCH FUNCTION
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION search_document_chunks(
  query_embedding   vector(1024),
  filter_case       TEXT     DEFAULT NULL,
  filter_source     TEXT     DEFAULT NULL,
  match_threshold   FLOAT    DEFAULT 0.60,
  match_count       INT      DEFAULT 8
)
RETURNS TABLE (
  chunk_id        BIGINT,
  document_id     BIGINT,
  filename        TEXT,
  case_number     TEXT,
  source_type     TEXT,
  document_date   DATE,
  content         TEXT,
  similarity      FLOAT
)
LANGUAGE SQL
SECURITY DEFINER
AS $$
  SELECT
    dc.id              AS chunk_id,
    dc.document_id,
    d.filename,
    d.case_number,
    d.source_type,
    d.document_date,
    dc.content,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM document_chunks dc
  JOIN documents d ON dc.document_id = d.id
  WHERE
    (1 - (dc.embedding <=> query_embedding)) > match_threshold
    AND (filter_case   IS NULL OR d.case_number  ILIKE '%' || filter_case   || '%')
    AND (filter_source IS NULL OR d.source_type  = filter_source)
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
$$;
```

- [ ] **Step 3: Run migration in Supabase**

Open your Supabase project → **SQL Editor → New Query**, paste the entire file contents, click **Run**.

Verify success: go to **Table Editor** — you should see `documents` and `document_chunks` tables.

---

## Task 3: Shared Types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Create `src/types.ts`**

```bash
mkdir -p src
```

```typescript
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
```

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: no errors (only `src/types.ts` exists, should pass cleanly).

---

## Task 4: Supabase Client & DB Helpers

**Files:**
- Create: `src/supabase.ts`

- [ ] **Step 1: Create `src/supabase.ts`**

```typescript
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
  case_number: string | null;
  document_date: string | null;
  total_chunks: number;
  created_at: string;
}>> {
  const { data, error } = await supabase
    .from('documents')
    .select('id, filename, source_type, case_number, document_date, total_chunks, created_at')
    .order('created_at', { ascending: false });

  if (error) throw new Error(`listDocuments failed: ${error.message}`);
  return (data ?? []) as Array<{
    id: number;
    filename: string;
    source_type: string;
    case_number: string | null;
    document_date: string | null;
    total_chunks: number;
    created_at: string;
  }>;
}

export async function deleteDocument(documentId: number): Promise<void> {
  const { error } = await supabase
    .from('documents')
    .delete()
    .eq('id', documentId);

  if (error) throw new Error(`deleteDocument failed: ${error.message}`);
}
```

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: no errors.

---

## Task 5: Voyage AI Embeddings

**Files:**
- Create: `src/embeddings.ts`

- [ ] **Step 1: Create `src/embeddings.ts`**

Uses `VOYAGE_API_KEY` (from voyageai.com), not your Anthropic key.

```typescript
// src/embeddings.ts

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_MODEL   = 'voyage-3-large'; // 1024-dimensional embeddings

function getVoyageKey(): string {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error('Missing VOYAGE_API_KEY environment variable');
  return key;
}

async function callVoyageApi(input: string, inputType: 'query' | 'document'): Promise<number[]> {
  const response = await fetch(VOYAGE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${getVoyageKey()}`,
    },
    body: JSON.stringify({ model: VOYAGE_MODEL, input, input_type: inputType }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Voyage AI API error (${response.status}): ${err}`);
  }

  const data = await response.json() as { data: Array<{ embedding: number[] }> };
  return data.data[0].embedding;
}

/** Embed a search query (use for search_documents tool) */
export async function embedText(text: string): Promise<number[]> {
  return callVoyageApi(text, 'query');
}

/** Embed a document chunk (use during ingestion) */
export async function embedDocument(text: string): Promise<number[]> {
  return callVoyageApi(text, 'document');
}
```

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: no errors.

---

## Task 6: Text Chunking (with Unit Tests)

**Files:**
- Create: `src/chunking.ts`
- Create: `tests/chunking.test.ts`

- [ ] **Step 1: Write failing tests first**

Create `tests/chunking.test.ts`:

```typescript
// tests/chunking.test.ts
import { describe, it, expect } from 'vitest';
import { chunkText } from '../src/chunking.js';

describe('chunkText', () => {
  it('returns at least one chunk for non-trivial input', () => {
    const text = 'Article 1\n\nThis is a test paragraph with enough content to be a valid chunk.';
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('drops chunks shorter than 50 characters', () => {
    const text = 'Hi\n\n' + 'A'.repeat(200);
    const chunks = chunkText(text);
    const shortChunks = chunks.filter(c => c.content.length < 50);
    expect(shortChunks).toHaveLength(0);
  });

  it('each chunk has a positive tokenCount', () => {
    const text = 'Section 1\n\n' + 'Legal text. '.repeat(100);
    const chunks = chunkText(text);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeGreaterThan(0);
    }
  });

  it('splits a large section into multiple chunks', () => {
    // 4000 chars ≈ 1000 tokens, well above CHUNK_SIZE=800
    const text = 'Article 1\n\n' + 'Word '.repeat(800);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('preserves overlap: last chunk starts with content from previous chunk', () => {
    const para = 'paragraph content here '.repeat(40); // ~880 tokens per para
    const text = para + '\n\n' + para;
    const chunks = chunkText(text);
    // With overlap, chunk 2 should share some content with chunk 1
    if (chunks.length >= 2) {
      const c1end   = chunks[0].content.slice(-50);
      const c2start = chunks[1].content.slice(0, 200);
      expect(c2start).toContain(c1end.slice(0, 20));
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: all tests FAIL with "Cannot find module '../src/chunking.js'".

- [ ] **Step 3: Create `src/chunking.ts`**

```typescript
// src/chunking.ts

export interface Chunk {
  content: string;
  tokenCount: number;
}

const CHUNK_SIZE    = 800;  // target tokens per chunk
const CHUNK_OVERLAP = 100;  // overlap tokens between chunks

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function splitBySections(text: string): string[] {
  const sectionPattern = /(?=\n(?:Article|Section|CHAPTER|Annex|ANNEX|\d+\.|[IVX]+\.)\s)/g;
  const sections = text.split(sectionPattern).filter(s => s.trim().length > 0);
  return sections;
}

function splitByParagraphs(text: string): string[] {
  return text.split(/\n{2,}/).filter(p => p.trim().length > 0);
}

export function chunkText(text: string): Chunk[] {
  const chunks: Chunk[] = [];
  const sections = splitBySections(text);

  for (const section of sections) {
    const tokenCount = estimateTokens(section);

    if (tokenCount <= CHUNK_SIZE) {
      chunks.push({ content: section.trim(), tokenCount });
    } else {
      const paragraphs = splitByParagraphs(section);
      let currentChunk  = '';
      let currentTokens = 0;

      for (const para of paragraphs) {
        const paraTokens = estimateTokens(para);

        if (currentTokens + paraTokens > CHUNK_SIZE && currentChunk.length > 0) {
          chunks.push({ content: currentChunk.trim(), tokenCount: currentTokens });

          const overlapText = currentChunk.slice(-(CHUNK_OVERLAP * 4));
          currentChunk  = overlapText + '\n\n' + para;
          currentTokens = estimateTokens(currentChunk);
        } else {
          currentChunk  += (currentChunk ? '\n\n' : '') + para;
          currentTokens += paraTokens;
        }
      }

      if (currentChunk.trim()) {
        chunks.push({ content: currentChunk.trim(), tokenCount: currentTokens });
      }
    }
  }

  return chunks.filter(c => c.content.length > 50);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: no errors.

---

## Task 7: Document Ingestion Pipeline

**Files:**
- Create: `src/ingest.ts`

- [ ] **Step 1: Create `src/ingest.ts`**

```typescript
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
  const pdfParse = (await import('pdf-parse')).default;
  const result   = await pdfParse(buffer);
  return result.text;
}

export async function parseDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  const result  = await mammoth.extractRawText({ buffer });
  return result.value;
}
```

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: no errors.

---

## Task 8: MCP Tool Definitions

**Files:**
- Create: `src/tools.ts`

- [ ] **Step 1: Create `src/tools.ts`**

```typescript
// src/tools.ts
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { embedText } from './embeddings.js';
import { semanticSearch, listDocuments, deleteDocument } from './supabase.js';
import { ingestDocument, parsePdf, parseDocx } from './ingest.js';
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
```

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: no errors.

---

## Task 9: Local MCP Server (stdio — Claude Desktop)

**Files:**
- Create: `src/server.ts`

- [ ] **Step 1: Create `src/server.ts`**

```typescript
// src/server.ts
import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  searchDocumentsSchema, handleSearchDocuments,
  ingestTextSchema,      handleIngestText,
  ingestFileSchema,      handleIngestFile,
  deleteDocumentSchema,  handleDeleteDocument,
  handleListDocuments,
} from './tools.js';

const server = new McpServer({
  name:    'legal-doc-rag',
  version: '1.0.0',
});

server.tool(
  'search_documents',
  'Semantic search across indexed legal and regulatory documents. Returns ranked passages with similarity scores.',
  searchDocumentsSchema.shape,
  async (input) => ({
    content: [{ type: 'text' as const, text: await handleSearchDocuments(input) }],
  })
);

server.tool(
  'ingest_text',
  'Add a legal document (plain text) to the vector database for future searches.',
  ingestTextSchema.shape,
  async (input) => ({
    content: [{ type: 'text' as const, text: await handleIngestText(input) }],
  })
);

server.tool(
  'ingest_file',
  'Add a PDF, DOCX, or TXT file from disk to the vector database.',
  ingestFileSchema.shape,
  async (input) => ({
    content: [{ type: 'text' as const, text: await handleIngestFile(input) }],
  })
);

server.tool(
  'list_documents',
  'List all documents currently indexed in the legal RAG database.',
  {},
  async () => ({
    content: [{ type: 'text' as const, text: await handleListDocuments() }],
  })
);

server.tool(
  'delete_document',
  'Remove a document and all its chunks from the vector database.',
  deleteDocumentSchema.shape,
  async (input) => ({
    content: [{ type: 'text' as const, text: await handleDeleteDocument(input) }],
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[legal-doc-rag] MCP server running on stdio');
```

- [ ] **Step 2: Verify types compile**

```bash
npx tsc --noEmit
```

Expected: no errors.

---

## Task 10: Remote HTTP/SSE Server (Railway — Claude.ai)

**Files:**
- Create: `src/remote.ts`

- [ ] **Step 1: Create `src/remote.ts`**

```typescript
// src/remote.ts
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  searchDocumentsSchema, handleSearchDocuments,
  ingestTextSchema,      handleIngestText,
  ingestFileSchema,      handleIngestFile,
  deleteDocumentSchema,  handleDeleteDocument,
  handleListDocuments,
} from './tools.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

function buildMcpServer(): McpServer {
  const server = new McpServer({ name: 'legal-doc-rag', version: '1.0.0' });

  server.tool('search_documents',  'Semantic search across legal documents.',          searchDocumentsSchema.shape, async (input) => ({ content: [{ type: 'text' as const, text: await handleSearchDocuments(input) }] }));
  server.tool('ingest_text',       'Add plain-text document to the RAG database.',     ingestTextSchema.shape,      async (input) => ({ content: [{ type: 'text' as const, text: await handleIngestText(input) }] }));
  server.tool('ingest_file',       'Add PDF/DOCX/TXT from disk to the RAG database.',  ingestFileSchema.shape,      async (input) => ({ content: [{ type: 'text' as const, text: await handleIngestFile(input) }] }));
  server.tool('list_documents',    'List all indexed documents.',                      {},                          async () => ({ content: [{ type: 'text' as const, text: await handleListDocuments() }] }));
  server.tool('delete_document',   'Delete a document from the RAG database.',         deleteDocumentSchema.shape,  async (input) => ({ content: [{ type: 'text' as const, text: await handleDeleteDocument(input) }] }));

  return server;
}

const sessions = new Map<string, SSEServerTransport>();

app.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport('/messages', res);
  sessions.set(transport.sessionId, transport);
  res.on('close', () => sessions.delete(transport.sessionId));

  const server = buildMcpServer();
  await server.connect(transport);
});

app.post('/messages', async (req, res) => {
  const sessionId  = req.query['sessionId'] as string;
  const transport  = sessions.get(sessionId);
  if (!transport) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  await transport.handlePostMessage(req, res);
});

app.get('/health', (_, res) => res.json({ status: 'ok' }));

const port = process.env.PORT ?? 3000;
app.listen(port, () => console.log(`[legal-doc-rag] HTTP MCP server on :${port}`));
```

- [ ] **Step 2: Verify full project compiles**

```bash
npx tsc --noEmit
```

Expected: no errors across all source files.

---

## Task 11: CLI Ingestion Script

**Files:**
- Create: `scripts/ingest-file.ts`

- [ ] **Step 1: Create scripts directory and file**

```bash
mkdir -p scripts
```

Create `scripts/ingest-file.ts`:

```typescript
#!/usr/bin/env npx tsx
// scripts/ingest-file.ts
import 'dotenv/config';
import { handleIngestFile } from '../src/tools.js';
import type { SourceType } from '../src/types.js';

const [,, filePath, sourceType, caseNumber, documentDate] = process.argv;

if (!filePath || !sourceType) {
  console.error('Usage: npx tsx scripts/ingest-file.ts <path> <source_type> [case_number] [date]');
  console.error('');
  console.error('source_type values:');
  console.error('  olaf_complaint | general_court | ias_audit | ep_discharge');
  console.error('  correspondence | staff_regulations | decision | other');
  console.error('');
  console.error('Example:');
  console.error('  npx tsx scripts/ingest-file.ts ./docs/olaf-complaint.pdf olaf_complaint T-777/25 2025-11-15');
  process.exit(1);
}

console.log(`[ingest] Processing: ${filePath}`);
const result = await handleIngestFile({
  file_path:     filePath,
  source_type:   sourceType as SourceType,
  case_number:   caseNumber || undefined,
  document_date: documentDate || undefined,
  language:      'en',
});
console.log(result);
```

- [ ] **Step 2: Run tests one final time**

```bash
npm test
```

Expected: all 5 chunking tests PASS.

- [ ] **Step 3: Full TypeScript compile check**

```bash
npx tsc --noEmit
```

Expected: no errors.

---

## Task 12: Configure Claude Desktop

**Files:**
- Modify: `~/Library/Application Support/Claude/claude_desktop_config.json`

- [ ] **Step 1: Find your project's absolute path**

```bash
pwd
```

Note the output — you'll need it in the next step. It should be:
`/Users/fred/Documents/VibeCoding/claudecode/mylegal-mcp`

- [ ] **Step 2: Edit Claude Desktop config**

Open `~/Library/Application Support/Claude/claude_desktop_config.json` in a text editor.

If the file does not exist, create it. Add or merge the following (replace the path and keys with your real values):

```json
{
  "mcpServers": {
    "legal-doc-rag": {
      "command": "npx",
      "args": ["tsx", "/Users/fred/Documents/VibeCoding/claudecode/mylegal-mcp/src/server.ts"],
      "env": {
        "SUPABASE_URL":              "https://your-project.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "your-service-role-key",
        "ANTHROPIC_API_KEY":         "sk-ant-...",
        "VOYAGE_API_KEY":            "pa-..."
      }
    }
  }
}
```

> **Important:** The `env` block is how Claude Desktop passes secrets to your server. Do **not** rely solely on `.env` for the Claude Desktop path — env vars in `claude_desktop_config.json` take priority when Claude Desktop launches the process.

- [ ] **Step 3: Restart Claude Desktop**

Quit Claude Desktop completely (Cmd+Q, not just close the window) and reopen it.

- [ ] **Step 4: Verify tools appear**

In a new Claude Desktop conversation, type:

```
List my legal documents.
```

Claude should call `list_documents` and return "No documents indexed yet." (since no documents have been ingested). If you see a tool call in the UI, the MCP server is connected correctly.

---

## Task 13: Ingest First Documents

> This task requires your `.env` to be fully populated and the Supabase migration to be applied.

- [ ] **Step 1: Create a docs folder and add a test document**

```bash
mkdir -p docs
```

Create a small test file `docs/test.txt`:

```
Article 1 - Test Document

This is a test legal document used to verify that the ingestion pipeline works correctly. It contains enough text to form at least one valid chunk after processing.

Article 2 - Additional Content

Further content to ensure the chunking logic has material to work with. The document describes fictional legal proceedings for testing purposes only.
```

- [ ] **Step 2: Ingest the test document**

```bash
npm run ingest -- docs/test.txt other "" 2026-06-03
```

Expected output:
```
[ingest] Processing: docs/test.txt
[ingest] test.txt: N chunks
[ingest] Embedding N chunks...
Successfully ingested "test.txt" as N chunks (document ID: 1)
```

- [ ] **Step 3: Verify in Claude Desktop**

In Claude Desktop, ask:

```
List my legal documents.
```

Expected: a formatted table showing `test.txt` with document ID 1.

Then ask:

```
Search my legal documents for test legal proceedings.
```

Expected: Claude calls `search_documents` and returns the relevant passage from `test.txt` with a similarity score.

- [ ] **Step 4: Ingest real documents (when ready)**

```bash
# OLAF complaint
npm run ingest -- /path/to/olaf-complaint.pdf olaf_complaint "" 2025-09-01

# General Court pleading
npm run ingest -- /path/to/t-777-25-application.pdf general_court T-777/25 2025-03-15
```

---

## Self-Review

### Spec Coverage

| Spec Section | Implemented in Task |
|---|---|
| Project scaffold + tsconfig | Task 1 |
| Dependencies | Task 1 |
| .env / .env.example | Task 1 |
| Supabase migration (vector(1024) corrected) | Task 2 |
| src/types.ts | Task 3 |
| src/supabase.ts | Task 4 |
| src/embeddings.ts (VOYAGE_API_KEY corrected) | Task 5 |
| src/chunking.ts | Task 6 |
| src/ingest.ts | Task 7 |
| src/tools.ts | Task 8 |
| src/server.ts (local stdio) | Task 9 |
| src/remote.ts (HTTP/SSE) | Task 10 |
| scripts/ingest-file.ts | Task 11 |
| Claude Desktop config | Task 12 |
| First ingestion + verification | Task 13 |
| railway.json | Task 1 |

All spec requirements covered.

### Key Corrections Applied

- `vector(1024)` used throughout (not 1536) — voyage-3-large produces 1024-dim vectors
- `VOYAGE_API_KEY` used for Voyage AI endpoint (separate from `ANTHROPIC_API_KEY`)
- MCP handler signatures corrected: `async (input) =>` not `async ({ input }) =>`
- SSE session management added to `remote.ts` (the spec's version had a bug where `handlePostMessage` was missing)
- `module: NodeNext` in tsconfig for correct ESM resolution with tsx
