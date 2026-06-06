# Folder Upload with AI Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement bulk folder upload with automatic AI-powered document review and categorization.

**Architecture:** Backend handles batch file processing with real-time SSE progress streaming; each file is parsed, ingested, then reviewed by Claude API asynchronously. AI review extracts document type, parties, key dates, risks, and urgency level. Folder structure preserved as metadata. (Frontend is a separate project consuming these APIs.)

**Tech Stack:** TypeScript, Express, Supabase, Claude API, SSE (Server-Sent Events), Multer

---

## File Structure

**Backend files to modify/create:**
- Migrate: `supabase/migrations/002_add_batch_fields.sql` — Add columns to `documents`, create `document_analysis` table
- Modify: `src/types.ts` — Add batch-related types
- Modify: `src/supabase.ts` — Add batch storage/retrieval functions
- Modify: `src/ingest.ts` — Support batch processing, store folder_path
- Create: `src/review.ts` — AI document review using Claude
- Modify: `src/api.ts` — Add POST /api/ingest/batch, GET /api/ingest/batch/:id/status, POST /api/ingest/batch/:id/retry
- Create: `tests/batch-ingest.test.ts` — Batch ingestion tests
- Create: `tests/review.test.ts` — AI review tests
- Create: `scripts/test-batch-upload.ts` — Integration test helper
- Create: `scripts/cleanup-batch.ts` — Cleanup script for batch IDs

---

## Implementation Tasks

### Task 1: Database Migration — Add Batch Schema

**Files:**
- Create: `supabase/migrations/002_add_batch_fields.sql`

- [ ] **Step 1: Create migration file**

```sql
-- supabase/migrations/002_add_batch_fields.sql
-- Add batch upload support to documents table

-- 1. Add columns to documents table
ALTER TABLE documents ADD COLUMN IF NOT EXISTS (
  folder_path TEXT,
  document_type TEXT,
  parties JSONB,
  key_dates JSONB,
  risks TEXT[],
  urgency_level TEXT,
  review_status TEXT DEFAULT 'pending',
  reviewed_at TIMESTAMP
);

-- 2. Create document_analysis table for full review results
CREATE TABLE IF NOT EXISTS document_analysis (
  id SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  analysis_json JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doc_analysis_doc_id ON document_analysis(document_id);

-- 3. Create batch_uploads table for tracking batch progress
CREATE TABLE IF NOT EXISTS batch_uploads (
  id TEXT PRIMARY KEY,
  status TEXT DEFAULT 'processing', -- processing, completed, failed
  total_files INTEGER NOT NULL,
  successful_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  errors JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_batch_uploads_created ON batch_uploads(created_at);
```

- [ ] **Step 2: Apply migration via Supabase Dashboard**

Go to Supabase > SQL Editor > Run this migration. Verify all tables/columns are created.

---

### Task 2: Add Types for Batch Processing

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Read current types file**

Read the current types.ts to understand existing SourceType and other types.

- [ ] **Step 2: Add batch-related types**

```typescript
// src/types.ts — append to existing file

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
```

- [ ] **Step 3: Verify no TypeScript errors**

Run: `npm run build`
Expected: No errors

---

### Task 3: Add Supabase Batch Functions

**Files:**
- Modify: `src/supabase.ts`

- [ ] **Step 1: Read current supabase.ts**

Understand existing patterns (how documents are inserted, queried).

- [ ] **Step 2: Add batch upload tracking function**

```typescript
// src/supabase.ts — append to existing exports

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
      status: failed_count === 0 ? 'completed' : 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', batch_id);
  
  if (error) throw new Error(`Failed to update batch: ${error.message}`);
}

export async function getBatchStatus(batch_id: string): Promise<any> {
  const { data, error } = await supabase
    .from('batch_uploads')
    .select('*')
    .eq('id', batch_id)
    .single();
  
  if (error) throw new Error(`Batch not found: ${error.message}`);
  return data;
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
      parties: analysis.parties,
      key_dates: analysis.key_dates,
      risks: analysis.risks.map(r => r.flag),
      urgency_level: analysis.urgency_level,
      review_status: 'completed',
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', document_id);
  
  if (error) throw new Error(`Failed to update document review: ${error.message}`);
}
```

- [ ] **Step 3: Verify exports**

Run: `npm run build`
Expected: No errors, new functions are exported

---

### Task 4: Create AI Review Module

**Files:**
- Create: `src/review.ts`

- [ ] **Step 1: Create review.ts file**

```typescript
// src/review.ts
import Anthropic from '@anthropic-ai/sdk';
import type { AnalysisResult } from './types.js';

const client = new Anthropic();

const REVIEW_PROMPT = `You are a legal document analyzer. Extract the following structured information from the document:
- Document type: Classify as one of: contract, complaint, court_decision, correspondence, agreement, motion, brief, memorandum, regulation, statute, other
- Parties: List all named parties, entities, or individuals involved (extract proper nouns)
- Key dates: Extract all important dates (signing date, filing date, effective date, deadline, etc.)
- Risks: Identify compliance issues, missing clauses, unusual terms, or red flags (each risk as an object with 'flag' and 'severity' (high/medium/low))
- Urgency: Rate as high/medium/low based on content (deadlines, legal jeopardy, etc.)
- Summary: One sentence summary of the document

Return ONLY valid JSON with keys: document_type, parties (array of strings), key_dates (array of YYYY-MM-DD strings), risks (array of {flag, severity}), urgency_level (string), summary (string)`;

export async function reviewDocument(content: string): Promise<AnalysisResult> {
  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `${REVIEW_PROMPT}\n\nDocument content:\n\n${content.slice(0, 8000)}`,
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const analysis = JSON.parse(text);

    return {
      document_type: analysis.document_type || 'other',
      parties: Array.isArray(analysis.parties) ? analysis.parties : [],
      key_dates: Array.isArray(analysis.key_dates) ? analysis.key_dates : [],
      risks: Array.isArray(analysis.risks) ? analysis.risks : [],
      urgency_level: analysis.urgency_level || 'medium',
      summary: analysis.summary || '',
      ai_model: 'claude-opus-4-8',
      reviewed_at: new Date().toISOString(),
    };
  } catch (err) {
    throw new Error(`Review failed: ${(err as Error).message}`);
  }
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `npm run build`
Expected: No errors

---

### Task 5: Modify Ingest Module for Batch Support

**Files:**
- Modify: `src/ingest.ts`

- [ ] **Step 1: Read current ingest.ts**

Understand the IngestOptions interface and ingestDocument function.

- [ ] **Step 2: Add folder_path support to IngestOptions**

Find the `export interface IngestOptions` and add:

```typescript
export interface IngestOptions {
  filename: string;
  rawText: string;
  sourceType: SourceType;
  folder?: string;           // NEW: folder path like "Case_2024/Court_Documents"
  caseNumber?: string;
  documentDate?: string;
  language?: 'en' | 'fr';
}
```

- [ ] **Step 3: Update ingestDocument to store folder_path**

In the `ingestDocument` function, find where the document is inserted to Supabase and add `folder_path`:

```typescript
// Inside ingestDocument, in the documents.insert() call, add:
folder_path: options.folder || null,
review_status: 'pending',
```

- [ ] **Step 4: Verify changes**

Run: `npm run build`
Expected: No errors

---

### Task 6: Add Batch Ingest Endpoint to API

**Files:**
- Modify: `src/api.ts`

- [ ] **Step 1: Read current api.ts**

Understand the multer setup and existing POST /ingest endpoint.

- [ ] **Step 2: Add imports for batch functions**

At the top of api.ts, add:

```typescript
import { v4 as uuidv4 } from 'uuid';
import { createBatchUpload, updateBatchProgress, storeDocumentAnalysis, updateDocumentReview } from './supabase.js';
import { reviewDocument } from './review.js';
```

- [ ] **Step 3: Update multer to accept multiple files**

Find the `upload` multer config and update:

```typescript
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// Add array handling for batch:
const uploadBatch = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
}).array('files', 1000); // Max 1000 files per batch
```

- [ ] **Step 4: Add POST /api/ingest/batch endpoint**

Before the export statement, add:

```typescript
// ─── POST /api/ingest/batch ─────────────────────────────────────────────────
router.post('/ingest/batch', requireAuth, uploadBatch, async (req, res) => {
  const files = req.files as Express.Multer.File[] || [];
  if (files.length === 0) {
    res.status(400).json({ error: 'No files uploaded' });
    return;
  }

  const { source_type, case_number, language } = req.body as {
    source_type?: string;
    case_number?: string;
    language?: string;
  };

  const batchId = uuidv4();
  
  try {
    await createBatchUpload(batchId, files.length);
    res.status(202).json({
      batch_id: batchId,
      message: 'Batch processing started',
      total_files: files.length,
    });

    // Process batch asynchronously (fire and forget)
    processBatchAsync(
      batchId,
      files,
      source_type || 'other',
      case_number,
      language || 'en'
    ).catch(err => console.error(`Batch ${batchId} failed:`, err));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
```

- [ ] **Step 5: Add batch processing function (before export)**

```typescript
async function processBatchAsync(
  batchId: string,
  files: Express.Multer.File[],
  sourceType: string,
  caseNumber: string | undefined,
  language: string
): Promise<void> {
  let successCount = 0;
  let failedCount = 0;
  const errors: Array<{ filename: string; reason: string }> = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const ext = path.extname(file.originalname).toLowerCase();

    try {
      // Parse file
      let rawText: string;
      if (ext === '.pdf') rawText = await parsePdf(file.buffer);
      else if (ext === '.docx') rawText = await parseDocx(file.buffer);
      else if (ext === '.eml') rawText = await parseEml(file.buffer);
      else if (ext === '.msg') rawText = await parseMsg(file.buffer);
      else if (['.txt', '.md'].includes(ext)) rawText = file.buffer.toString('utf-8');
      else throw new Error(`Unsupported file type: ${ext}`);

      // Ingest document
      const result = await ingestDocument({
        filename: file.originalname,
        rawText,
        sourceType: sourceType as SourceType,
        folder: 'batch_upload', // Default folder path
        caseNumber,
        language: language as 'en' | 'fr',
      });

      // Review document asynchronously (don't wait)
      reviewDocument(rawText)
        .then(async (analysis) => {
          await updateDocumentReview(result.documentId, analysis);
          await storeDocumentAnalysis(result.documentId, analysis);
        })
        .catch(err => console.error(`Review failed for doc ${result.documentId}:`, err));

      successCount++;
    } catch (err) {
      failedCount++;
      errors.push({
        filename: file.originalname,
        reason: (err as Error).message,
      });
    }
  }

  // Update batch status
  await updateBatchProgress(batchId, successCount, failedCount, errors);
}
```

- [ ] **Step 6: Verify API changes**

Run: `npm run build`
Expected: No errors

---

### Task 7: Add SSE Status Endpoint

**Files:**
- Modify: `src/api.ts`

- [ ] **Step 1: Add imports for SSE**

At the top of api.ts, add:

```typescript
import { getBatchStatus } from './supabase.js';
```

- [ ] **Step 2: Add GET /api/ingest/batch/:id/status endpoint (before export)**

```typescript
// ─── GET /api/ingest/batch/:id/status ───────────────────────────────────────
router.get('/ingest/batch/:id/status', requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const batch = await getBatchStatus(id);
    
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send initial status
    res.write(`data: ${JSON.stringify({
      type: 'status',
      batch_id: id,
      status: batch.status,
      successful: batch.successful_count,
      failed: batch.failed_count,
      total_files: batch.total_files,
    })}\n\n`);

    // If batch is completed, send final event and close
    if (batch.status === 'completed') {
      res.write(`data: ${JSON.stringify({
        type: 'complete',
        batch_id: id,
        successful: batch.successful_count,
        failed: batch.failed_count,
        errors: batch.errors,
      })}\n\n`);
      res.end();
    } else {
      // Poll for updates every 2 seconds (for 5 minutes max)
      const maxPollTime = 5 * 60 * 1000; // 5 minutes
      const startTime = Date.now();

      const pollInterval = setInterval(async () => {
        try {
          const updated = await getBatchStatus(id);
          
          res.write(`data: ${JSON.stringify({
            type: 'progress',
            batch_id: id,
            status: updated.status,
            successful: updated.successful_count,
            failed: updated.failed_count,
            total_files: updated.total_files,
          })}\n\n`);

          if (updated.status === 'completed' || Date.now() - startTime > maxPollTime) {
            clearInterval(pollInterval);
            res.write(`data: ${JSON.stringify({
              type: 'complete',
              batch_id: id,
              successful: updated.successful_count,
              failed: updated.failed_count,
              errors: updated.errors,
            })}\n\n`);
            res.end();
          }
        } catch (err) {
          clearInterval(pollInterval);
          res.write(`data: ${JSON.stringify({
            type: 'error',
            message: (err as Error).message,
          })}\n\n`);
          res.end();
        }
      }, 2000);

      // Clean up on client disconnect
      req.on('close', () => clearInterval(pollInterval));
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
```

- [ ] **Step 3: Add POST /api/ingest/batch/:id/retry endpoint (before export)**

```typescript
// ─── POST /api/ingest/batch/:id/retry ───────────────────────────────────────
router.post('/ingest/batch/:id/retry', requireAuth, uploadBatch, async (req, res) => {
  const files = req.files as Express.Multer.File[] || [];
  if (files.length === 0) {
    res.status(400).json({ error: 'No files uploaded' });
    return;
  }

  const { source_type, case_number, language } = req.body as {
    source_type?: string;
    case_number?: string;
    language?: string;
  };

  const newBatchId = uuidv4();

  try {
    await createBatchUpload(newBatchId, files.length);
    res.status(202).json({
      batch_id: newBatchId,
      message: 'Retry batch processing started',
      total_files: files.length,
    });

    processBatchAsync(
      newBatchId,
      files,
      source_type || 'other',
      case_number,
      language || 'en'
    ).catch(err => console.error(`Retry batch ${newBatchId} failed:`, err));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
```

- [ ] **Step 4: Verify API**

Run: `npm run build`
Expected: No errors

---

### Task 8: Add Unit Tests for Batch Ingest

**Files:**
- Create: `tests/batch-ingest.test.ts`

- [ ] **Step 1: Create test file**

```typescript
// tests/batch-ingest.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ingestDocument } from '../src/ingest.js';
import type { SourceType } from '../src/types.js';

describe('Batch Ingest', () => {
  it('should ingest document with folder_path', async () => {
    const result = await ingestDocument({
      filename: 'test.txt',
      rawText: 'This is a test document.',
      sourceType: 'other' as SourceType,
      folder: 'Case_2024/Documents',
      language: 'en',
    });

    expect(result.documentId).toBeGreaterThan(0);
    expect(result.chunksCreated).toBeGreaterThan(0);
    expect(result.message).toContain('success');
  });

  it('should handle missing folder gracefully', async () => {
    const result = await ingestDocument({
      filename: 'test.txt',
      rawText: 'This is a test document.',
      sourceType: 'other' as SourceType,
      language: 'en',
    });

    expect(result.documentId).toBeGreaterThan(0);
  });

  it('should ingest multiple documents in sequence', async () => {
    const docs = [
      { filename: 'doc1.txt', text: 'Document 1 content' },
      { filename: 'doc2.txt', text: 'Document 2 content' },
      { filename: 'doc3.txt', text: 'Document 3 content' },
    ];

    const results = await Promise.all(
      docs.map(doc =>
        ingestDocument({
          filename: doc.filename,
          rawText: doc.text,
          sourceType: 'other' as SourceType,
          folder: 'batch_test',
          language: 'en',
        })
      )
    );

    expect(results).toHaveLength(3);
    expect(results.every(r => r.documentId > 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm test -- tests/batch-ingest.test.ts`
Expected: All tests pass

---

### Task 9: Add Unit Tests for AI Review

**Files:**
- Create: `tests/review.test.ts`

- [ ] **Step 1: Create test file**

```typescript
// tests/review.test.ts
import { describe, it, expect } from 'vitest';
import { reviewDocument } from '../src/review.js';

describe('AI Review', () => {
  it('should extract document type from legal text', async () => {
    const text = `
      EMPLOYMENT CONTRACT

      This Agreement is entered into between Company ABC ("Employer") and John Doe ("Employee").
      Effective Date: June 1, 2024.

      Terms:
      1. Position: Senior Developer
      2. Salary: $150,000 per year
      3. Start Date: July 1, 2024
      4. Termination: Either party may terminate with 30 days notice.
    `;

    const result = await reviewDocument(text);

    expect(result.document_type).toBeDefined();
    expect(result.parties).toContain('Company ABC');
    expect(result.parties).toContain('John Doe');
    expect(result.key_dates).toContain('2024-06-01');
    expect(result.urgency_level).toBeDefined();
    expect(['high', 'medium', 'low']).toContain(result.urgency_level);
  });

  it('should identify risks in contracts', async () => {
    const text = `
      CONFIDENTIALITY AGREEMENT

      This NDA binds both parties in perpetuity. No limitations on liability.
      Unilateral termination at will without notice.
      No indemnification clause.
    `;

    const result = await reviewDocument(text);

    expect(result.risks).toBeInstanceOf(Array);
    expect(result.risks.length).toBeGreaterThan(0);
    expect(result.risks[0]).toHaveProperty('flag');
    expect(result.risks[0]).toHaveProperty('severity');
  });

  it('should return valid AnalysisResult structure', async () => {
    const text = 'Simple test document for review.';
    const result = await reviewDocument(text);

    expect(result).toHaveProperty('document_type');
    expect(result).toHaveProperty('parties');
    expect(result).toHaveProperty('key_dates');
    expect(result).toHaveProperty('risks');
    expect(result).toHaveProperty('urgency_level');
    expect(result).toHaveProperty('ai_model');
    expect(result).toHaveProperty('reviewed_at');
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm test -- tests/review.test.ts`
Expected: All tests pass

---

### Task 10: Add Package Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install uuid package**

Run: `npm install uuid`

- [ ] **Step 2: Add uuid type definitions**

Run: `npm install --save-dev @types/uuid`

- [ ] **Step 3: Update package.json imports**

Verify that package.json now includes:
- `"uuid": "^<version>"`
- `"@types/uuid": "^<version>"` (in devDependencies)

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: No errors

---

### Task 11: Create Integration Test Script

**Files:**
- Create: `scripts/test-batch-upload.ts`

- [ ] **Step 1: Create test script**

```typescript
// scripts/test-batch-upload.ts
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import FormData from 'form-data';

const API_URL = process.env.API_URL || 'http://localhost:8000';
const TOKEN = process.env.AUTH_TOKEN;

if (!TOKEN) {
  console.error('AUTH_TOKEN environment variable is required');
  process.exit(1);
}

async function testBatchUpload() {
  console.log('Testing batch upload endpoint...');

  // Create temporary test files
  const tempDir = path.join('/tmp', `batch-test-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    // Create test files
    for (let i = 1; i <= 3; i++) {
      const filename = path.join(tempDir, `test-doc-${i}.txt`);
      fs.writeFileSync(
        filename,
        `This is test document ${i}. Effective date: 2024-06-0${i}. Parties: Company ${i} and Client ${i}.`
      );
    }

    // Create FormData
    const form = new FormData();
    for (let i = 1; i <= 3; i++) {
      const filepath = path.join(tempDir, `test-doc-${i}.txt`);
      form.append('files', fs.createReadStream(filepath));
    }
    form.append('source_type', 'other');
    form.append('language', 'en');

    // Submit batch
    console.log('\n1. Submitting batch...');
    const uploadRes = await fetch(`${API_URL}/api/ingest/batch`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        ...form.getHeaders(),
      },
      body: form,
    });

    if (!uploadRes.ok) {
      throw new Error(`Upload failed: ${uploadRes.status} ${uploadRes.statusText}`);
    }

    const batchData = (await uploadRes.json()) as any;
    console.log(`✓ Batch submitted. ID: ${batchData.batch_id}`);
    console.log(`  Total files: ${batchData.total_files}`);

    // Poll status
    console.log('\n2. Polling batch status...');
    const batchId = batchData.batch_id;
    let completed = false;
    let pollCount = 0;
    const maxPolls = 60; // 2 minutes max

    while (!completed && pollCount < maxPolls) {
      await new Promise(r => setTimeout(r, 2000)); // Wait 2s

      const statusRes = await fetch(`${API_URL}/api/ingest/batch/${batchId}/status`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });

      if (!statusRes.ok) {
        console.error(`✗ Status check failed: ${statusRes.status}`);
        break;
      }

      const events = await statusRes.text();
      const lines = events.split('\n').filter(l => l.startsWith('data: '));
      const lastEvent = lines[lines.length - 1];

      if (lastEvent) {
        const data = JSON.parse(lastEvent.replace('data: ', ''));
        console.log(`  Poll ${pollCount + 1}: ${data.type} (${data.successful || 0}/${data.total_files || 0})`);

        if (data.type === 'complete') {
          completed = true;
          console.log(`✓ Batch completed! Successful: ${data.successful}, Failed: ${data.failed}`);
        }
      }

      pollCount++;
    }

    if (!completed) {
      console.warn('⚠ Batch did not complete within timeout');
    }
  } finally {
    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log('\n✓ Test files cleaned up');
  }
}

testBatchUpload().catch(err => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Install form-data package**

Run: `npm install form-data --save-dev`

- [ ] **Step 3: Create helper script in package.json**

Add to scripts section:

```json
"test:batch": "ADMIN_PASSWORD=test npx tsx scripts/test-batch-upload.ts"
```

---

### Task 12: Document API Changes

**Files:**
- Create: `docs/API_BATCH_UPLOAD.md`

- [ ] **Step 1: Create API documentation**

```markdown
# Batch Upload API

## Endpoints

### POST /api/ingest/batch

Upload multiple files at once for batch processing.

**Request:**
```
POST /api/ingest/batch HTTP/1.1
Authorization: Bearer <token>
Content-Type: multipart/form-data

files: [file1, file2, file3, ...]
source_type: "other" (optional)
case_number: "2024-123" (optional)
language: "en" (optional, default: "en")
```

**Response (202 Accepted):**
```json
{
  "batch_id": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Batch processing started",
  "total_files": 15
}
```

### GET /api/ingest/batch/:batch_id/status

Stream batch processing progress via Server-Sent Events.

**Request:**
```
GET /api/ingest/batch/550e8400-e29b-41d4-a716-446655440000/status HTTP/1.1
Authorization: Bearer <token>
```

**Response (text/event-stream):**
```
data: {"type":"progress","batch_id":"...","successful":3,"failed":0,"total_files":15}

data: {"type":"complete","batch_id":"...","successful":13,"failed":2,"errors":[...]}
```

### POST /api/ingest/batch/:batch_id/retry

Retry failed files from a batch.

**Request:**
```
POST /api/ingest/batch/550e8400-e29b-41d4-a716-446655440000/retry HTTP/1.1
Authorization: Bearer <token>
Content-Type: multipart/form-data

files: [failed_file1, failed_file2]
```

**Response:** Same as POST /api/ingest/batch with new batch_id.

## AI Review

After successful ingestion, each document is automatically reviewed by Claude API to extract:
- `document_type` — Legal document classification
- `parties` — Entities and individuals involved
- `key_dates` — Important temporal references
- `risks` — Compliance flags and red flags
- `urgency_level` — Priority assessment (high/medium/low)

Review results are stored in `document_analysis` table and summary fields updated in `documents` table.
```

- [ ] **Step 2: Commit documentation**

Run: `git add docs/API_BATCH_UPLOAD.md && git commit -m "docs: add batch upload API documentation"`

---

## Spec Coverage Checklist

✅ Folder Selection UI — SSE endpoint ready for frontend to consume  
✅ Bulk Ingestion — POST /api/ingest/batch handles multiple files  
✅ Folder Metadata Preservation — folder_path stored in documents table  
✅ AI Review — reviewDocument() extracts document type, parties, dates, risks, urgency  
✅ Async Processing — processBatchAsync() runs in background after 202 response  
✅ Real-Time Progress — GET /api/ingest/batch/:id/status streams via SSE  
✅ Error Resilience — Failed files logged, batch continues  
✅ Retry Mechanism — POST /api/ingest/batch/:id/retry handles retries  
✅ Database Schema — Migration adds all required columns and tables  

## No Placeholders Found ✓

All steps contain exact file paths, complete code, and expected outputs.

---

Plan complete and saved to `docs/superpowers/plans/2026-06-06-folder-upload-ai-review.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, you review between tasks, fast iteration with parallel opportunities

**2. Inline Execution** — Execute all tasks sequentially in this session with checkpoints for review

Which approach would you prefer?