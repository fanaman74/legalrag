# Folder Upload with AI Review & Categorization — Design Spec

**Date:** 2026-06-06  
**Status:** Design approved, ready for implementation planning

---

## Overview

Add bulk folder upload capability to the legal document ingestion system. When users upload a folder (with subfolders), all files are processed asynchronously with real-time progress feedback via Server-Sent Events (SSE). Each document is automatically reviewed and categorized by AI (using Claude) to extract document type, parties, key dates, risks, and urgency level. Folder structure is flattened but preserved as metadata for categorization.

---

## Requirements

### Functional

1. **Folder Selection UI** — Browser file input with `webkitdirectory` attribute lets users select an entire folder
2. **Bulk Ingestion** — Handle multiple files (10-100+) in a single upload request
3. **Folder Metadata Preservation** — Subfolder names are captured as `folder_path` metadata (e.g., "Case_2024/Court_Documents")
4. **AI Review** — Each document automatically reviewed by Claude for:
   - Document type (contract, complaint, decision, correspondence, etc.)
   - Parties involved (extracted entities)
   - Key dates (identified temporal references)
   - Risk flags (compliance issues, red flags, missing clauses)
   - Urgency level (high/medium/low)
5. **Async Processing** — Files ingest immediately, AI review happens in background (non-blocking)
6. **Real-Time Progress** — SSE stream shows live progress (file count, current file, success/failure)
7. **Error Resilience** — Invalid files skipped with reason logged; batch continues on partial failures
8. **Retry Mechanism** — Failed files can be retried from results screen

### Non-Functional

- No blocking on upload completion (user sees results as they arrive)
- Support folders with 100+ files without timeout
- Preserve existing single-file upload (`/api/ingest`) unchanged
- Review results queryable/filterable in Documents view

---

## Architecture

### Database Schema Changes

#### `documents` table — Add columns:

```sql
ALTER TABLE documents ADD COLUMN IF NOT EXISTS (
  folder_path TEXT,                    -- "Case_2024/Court_Documents"
  document_type TEXT,                  -- "contract", "complaint", "decision", etc.
  parties JSONB,                       -- ["Plaintiff ABC", "Defendant XYZ"]
  key_dates JSONB,                     -- ["2024-03-15", "2024-06-01"]
  risks TEXT[],                        -- ["missing_clause_X", "non_compliance_Y"]
  urgency_level TEXT,                  -- "high", "medium", "low"
  review_status TEXT DEFAULT 'pending', -- "pending", "completed", "failed"
  reviewed_at TIMESTAMP
);
```

#### New `document_analysis` table:

```sql
CREATE TABLE document_analysis (
  id SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  analysis_json JSONB NOT NULL,        -- Full AI review response
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_doc_analysis_doc_id ON document_analysis(document_id);
```

**Analysis JSON structure:**
```json
{
  "document_type": "contract",
  "parties": ["Party A", "Party B"],
  "key_dates": ["2024-03-15", "2024-06-01"],
  "risks": [
    { "flag": "missing_indemnification_clause", "severity": "high" },
    { "flag": "non_compliant_termination_terms", "severity": "medium" }
  ],
  "urgency_level": "high",
  "summary": "...",
  "ai_model": "claude-opus-4.8",
  "reviewed_at": "2026-06-06T12:34:56Z"
}
```

---

## API Endpoints

### POST /api/ingest/batch

**Request:**
- Method: `POST`
- Content-Type: `multipart/form-data`
- Auth: Bearer token required
- Body:
  ```
  files: File[] (multiple files from webkitdirectory)
  source_type: string (optional, defaults to "other")
  case_number: string (optional)
  language: "en" | "fr" (optional, defaults to "en")
  ```

**Response (immediate, 202 Accepted):**
```json
{
  "batch_id": "uuid-or-incremental-id",
  "message": "Batch processing started",
  "total_files": 15
}
```

**Background behavior:**
- Files parsed according to extension (PDF, DOCX, EML, MSG, TXT, MD)
- Each file ingested to `documents` table with `review_status: 'pending'`
- AI review queued immediately after ingestion
- Progress streamed to SSE endpoint

### GET /api/ingest/batch/:batch_id/status (Server-Sent Events)

**Request:**
- Method: `GET`
- Auth: Bearer token required
- Response: `text/event-stream`

**Progress event (per file):**
```json
{
  "type": "progress",
  "batch_id": "...",
  "file_index": 3,
  "total_files": 15,
  "filename": "document.pdf",
  "status": "processing", // or "success", "failed"
  "document_id": 42,
  "error": null // or error message if failed
}
```

**Completion event:**
```json
{
  "type": "complete",
  "batch_id": "...",
  "successful": 13,
  "failed": 2,
  "errors": [
    { "filename": "bad.exe", "reason": "Unsupported file type" },
    { "filename": "corrupted.pdf", "reason": "PDF parse error" }
  ]
}
```

### POST /api/ingest/batch/:batch_id/retry

**Request:**
- Method: `POST`
- Auth: Bearer token required
- Body:
  ```json
  {
    "filenames": ["bad.exe", "corrupted.pdf"]
  }
  ```

**Response:** Same as POST /api/ingest/batch (returns new batch_id and opens SSE stream)

---

## Frontend: Upload Page

**Route:** `/upload`

**Sections:**

1. **Upload Zone**
   - Prompt: "Select a folder to upload all documents"
   - File input: `<input type="file" webkitdirectory />`
   - Button: "Select Folder"
   - Supported formats listed below input

2. **File Preview** (after selection, before upload)
   - Tree view showing folder structure
   - File count: "Ready to upload 23 files"
   - Buttons: "Upload" or "Cancel"

3. **Progress (during upload)**
   - Progress bar: `3 / 23 files processed`
   - Current file label: "Processing: document_42.pdf"
   - Live status list:
     - ✅ file_1.pdf (Document ID: 42)
     - ✅ file_2.docx (Document ID: 43)
     - ⏳ file_3.pdf (AI review in progress...)
     - ❌ file_4.exe (Unsupported format)

4. **Results (after completion)**
   - Summary: "Successfully uploaded 21 of 23 files"
   - Tabs:
     - **Successful** — List with document IDs, folder paths, detected types
     - **Failed** — List with filenames and error reasons
   - Buttons:
     - "Retry Failed Files" (if failures exist)
     - "View Documents" (navigate to Documents view)

---

## AI Review Workflow

**Trigger:** After each file is successfully ingested to `documents` table

**Prompt to Claude:**
```
You are analyzing a legal document. Extract the following structured information:
- Document type (e.g., contract, complaint, court decision, correspondence, etc.)
- Parties involved (any proper nouns or entities)
- Key dates (all temporal references)
- Risk flags (compliance issues, missing clauses, unusual terms)
- Urgency level (high/medium/low based on content)

Return as JSON only, no markdown.
```

**Processing:**
1. Get document content from Supabase
2. Call Anthropic API (Claude) with prompt + content
3. Parse response JSON
4. Update `documents` table: `document_type`, `parties`, `key_dates`, `risks`, `urgency_level`, `review_status='completed'`, `reviewed_at`
5. Insert full response to `document_analysis` table
6. Stream progress event to SSE client

**Timeout/Retry:**
- If AI review takes >30s, mark as `review_status='pending'` and allow manual retry
- Manual retry via Documents view or batch retry endpoint

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Unsupported file type (.exe, .zip) | Skip, log "Unsupported file type", continue batch |
| Parse error (corrupted PDF) | Skip, log "PDF parse error: [details]", continue |
| AI review timeout | Ingest successfully, mark `review_status='pending'`, allow retry |
| Network error during batch | Display error, allow retry from results screen |
| Empty folder | Show "No files found" error |

---

## Data Flow

```
User selects folder
    ↓
Browser file input (webkitdirectory) → FormData
    ↓
POST /api/ingest/batch
    ↓
Return batch_id (202 Accepted)
    ↓
[Background]
For each file:
  1. Parse file (PDF/DOCX/EML/MSG/TXT/MD)
  2. Ingest to documents table (review_status='pending')
  3. Queue AI review
  4. Stream progress event: {type: 'progress', status: 'processing'}
  5. Call Claude API
  6. Update documents + insert document_analysis
  7. Stream progress event: {type: 'success'}
    ↓
Stream completion event: {type: 'complete', successful, failed}
    ↓
Frontend shows results
```

---

## Implementation Strategy

**Phase 1: Backend**
- Add database columns and analysis table
- Implement POST /api/ingest/batch endpoint
- Implement GET /api/ingest/batch/:id/status SSE endpoint
- Implement AI review logic + Claude integration

**Phase 2: Frontend**
- Create `/upload` page with folder picker and progress UI
- Implement SSE client connection
- Implement file tree preview and results display
- Implement retry logic

**Phase 3: Integration**
- Test folder uploads with 10-100 files
- Test error cases (corrupted files, timeouts)
- Add batch status to Documents view (optional)

---

## Constraints & Assumptions

1. **File size limit:** 20 MB per file (existing multer limit)
2. **Folder depth:** Assumed <10 levels deep for metadata clarity
3. **Concurrent files:** Process sequentially to avoid overwhelming Claude API (can batch later)
4. **SSE timeout:** Default 5 minutes; client can reconnect
5. **Language:** Default English; folder name or metadata can override
6. **Existing single-file upload:** Unchanged; folder upload is additive

---

## Success Criteria

- ✅ Users can select and upload entire folders with subfolders
- ✅ All files processed without blocking (async)
- ✅ Real-time progress visible via SSE stream
- ✅ Each document auto-reviewed with document type, parties, dates, risks, urgency
- ✅ Failed files can be retried
- ✅ Folder structure preserved in `folder_path` metadata
- ✅ Review results queryable/filterable in Documents view
- ✅ No regression in existing single-file upload functionality

---

## Open Questions / Future Enhancements

1. Should we batch-process AI reviews (e.g., review 5 files in parallel) to speed up large uploads?
2. Should review results be manually editable by users?
3. Should we add webhooks to notify external systems when batch completes?
4. Should review results be exportable (CSV/JSON)?
