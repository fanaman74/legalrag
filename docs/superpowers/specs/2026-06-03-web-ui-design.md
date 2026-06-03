# Legal RAG — Web Management UI Design

**Date:** 2026-06-03
**Status:** Approved

---

## Goal

Add a password-protected web UI served by the existing Railway Express server. The UI covers the full document lifecycle: upload (including nested folders and email formats), list, delete, and semantic search.

---

## Architecture

The existing `remote.ts` Express server is extended minimally:

- New `src/api.ts` — Express Router for all REST endpoints, mounted at `/api`
- New `public/index.html` — single-file vanilla JS + Tailwind CDN frontend, served as static files
- Updated `src/ingest.ts` — adds `parseEml` and `parseMsg` parsers
- Updated `src/tools.ts` — `handleIngestFile` routes `.eml` and `.msg` extensions
- Updated `remote.ts` — mounts `/api` router and serves `public/` as static files
- Two new npm packages: `mailparser`, `@kenjiuno/msgreader`
- One new npm dev package: `@types/mailparser`

MCP SSE (`/sse`, `/messages`) is untouched.

---

## New Environment Variable

| Variable | Description |
|---|---|
| `ADMIN_PASSWORD` | Login passphrase. Set in Railway dashboard. Min 8 chars recommended. |

Add to `.env`, `.env.example`, and Railway environment.

---

## Backend — `src/api.ts`

Express Router exported and mounted at `/api` in `remote.ts`.

### Authentication

**POST `/api/auth`** — public (no token required)

Request body:
```json
{ "password": "your-passphrase" }
```

Response (200 on success):
```json
{ "token": "<jwt>" }
```

Response (401 on failure):
```json
{ "error": "Invalid password" }
```

Token is a JWT signed with `ADMIN_PASSWORD` as the secret, expiry 24h. Payload: `{ sub: 'admin' }`.

All other `/api/*` routes require `Authorization: Bearer <token>` header. Missing or invalid token returns 401.

---

### Document Routes

**GET `/api/documents`**

Returns array of document records, newest first:
```json
[
  {
    "id": 1,
    "filename": "olaf-complaint.pdf",
    "source_type": "olaf_complaint",
    "case_number": "T-777/25",
    "document_date": "2025-09-01",
    "total_chunks": 42,
    "created_at": "2026-06-03T10:00:00Z"
  }
]
```

**DELETE `/api/documents/:id`**

Deletes document and all its chunks. Returns:
```json
{ "message": "Document 1 deleted." }
```

---

### Ingestion Route

**POST `/api/ingest`** — `multipart/form-data`

Fields:
| Field | Type | Required | Description |
|---|---|---|---|
| `file` | file | yes | The document file |
| `source_type` | string | yes | One of the 8 SourceType values |
| `case_number` | string | no | e.g. T-777/25 |
| `document_date` | string | no | ISO date e.g. 2025-11-15 |
| `language` | string | no | `en` or `fr`, default `en` |

File size limit: 20MB. Accepted extensions: `.pdf`, `.docx`, `.txt`, `.eml`, `.msg`.

Uses `multer` with `memoryStorage` — buffer passed directly to the appropriate parser. No temp files written to disk.

Response (200):
```json
{ "message": "Successfully ingested \"file.pdf\" as 42 chunks (document ID: 7)" }
```

Response (400): unsupported file type, missing required fields.
Response (500): embedding or DB error — includes error message.

---

### Search Route

**GET `/api/search`**

Query parameters:
| Param | Type | Default | Description |
|---|---|---|---|
| `q` | string | required | Natural language query |
| `source_type` | string | — | Filter by document type |
| `case_number` | string | — | Filter by case number |
| `threshold` | float | 0.60 | Minimum similarity (0–1) |
| `limit` | int | 8 | Max results (1–20) |

Response (200):
```json
[
  {
    "chunk_id": 101,
    "document_id": 1,
    "filename": "olaf-complaint.pdf",
    "case_number": "T-777/25",
    "source_type": "olaf_complaint",
    "document_date": "2025-09-01",
    "content": "...relevant passage...",
    "similarity": 0.87
  }
]
```

---

## Parsing Extensions — `src/ingest.ts`

Two new exported functions:

### `parseEml(buffer: Buffer): Promise<string>`

Uses `mailparser`. Extracts subject, from, to, date, and plain-text body. Returns formatted string:

```
From: sender@example.com
To: recipient@example.com
Date: 2025-11-15
Subject: Re: Contract Review

[plain text body]
```

If HTML-only email, strips HTML tags to get plain text.

### `parseMsg(buffer: Buffer): Promise<string>`

Uses `@kenjiuno/msgreader`. Same output format as `parseEml`.

### `handleIngestFile` update — `src/tools.ts`

Add two new extension branches after the `.docx` branch:
```
else if (ext === '.eml')  rawText = await parseEml(buffer);
else if (ext === '.msg')  rawText = await parseMsg(buffer);
```

---

## Frontend — `public/index.html`

Single HTML file. Tailwind loaded from CDN. No build step. Served as static from Express.

### Login View

Shown when no valid JWT in `localStorage`. Centred card:
- App title
- Password input
- Login button
- Error message shown inline on failure

On success: stores JWT in `localStorage`, renders Main App.

### Main App

Persistent header with app title + Logout button (clears `localStorage`, returns to login).

Three tabs:

---

### Tab 1: Upload

**Two mode buttons:** `Files` | `Folder`

- **Files mode:** `<input type="file" multiple accept=".pdf,.docx,.txt,.eml,.msg">`
- **Folder mode:** `<input type="file" webkitdirectory>` — selects entire folder tree recursively

Below the file picker, a metadata form (applies to all files in the batch):
- **Source Type** — `<select>` with all 8 options. Auto-selects `correspondence` when **all** selected files are `.eml` or `.msg`. Mixed batches leave the selection unchanged.
- **Case Number** — optional text input
- **Document Date** — optional date input
- **Language** — `<select>` with `en` / `fr`

**Upload button** — disabled until at least one valid file is selected.

**Progress list** — appears after upload starts. One row per file:
```
📄 olaf-complaint.pdf     [ingesting...]
📧 email-2025-11-15.eml   [✓ done — 12 chunks]
📄 audit-report.docx      [✗ error: file too large]
```

Files are processed **sequentially** (one at a time) to avoid overwhelming the Voyage AI embedding API.

Files with unsupported extensions (e.g. `.jpg`, `.zip`) are silently skipped with a note in the progress list.

---

### Tab 2: Documents

Loaded when the tab is opened (or after any delete). A refresh button reloads manually.

Table columns: **ID | Filename | Type | Case | Date | Chunks | Created | Actions**

Actions column: **Delete** button (red). On click:
- Confirm dialog: `"Delete '[filename]' and all its chunks? This cannot be undone."`
- On confirm: `DELETE /api/documents/:id` → remove row from table

Empty state: "No documents indexed yet. Upload some documents to get started."

---

### Tab 3: Search

**Query input** (full width) + **Search button**

Collapsible **Filters** section:
- Source Type dropdown
- Case Number text input
- Threshold slider (0.50 → 1.00, step 0.05, default 0.60, shows current value)
- Limit number input (1–20, default 8)

**Results** — shown as cards below the search form. Each card:
```
┌─────────────────────────────────────────────┐
│ olaf-complaint.pdf          [87.3% match]   │
│ Type: olaf_complaint  |  Case: T-777/25     │
│ Date: 2025-09-01                            │
│                                             │
│ ...relevant passage text from the chunk...  │
└─────────────────────────────────────────────┘
```

Empty results: "No results found. Try lowering the threshold or broadening your query."
Loading state: spinner while request is in flight.

---

## `remote.ts` Changes

```typescript
import apiRouter from './api.js';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

app.use('/api', apiRouter);
app.use(express.static(join(__dirname, '..', 'public')));
// SPA fallback — serve index.html for any non-API, non-asset route
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api') && !req.path.startsWith('/sse') && !req.path.startsWith('/messages')) {
    res.sendFile(join(__dirname, '..', 'public', 'index.html'));
  }
});
```

---

## New Dependencies

```bash
npm install mailparser @kenjiuno/msgreader multer jsonwebtoken
npm install --save-dev @types/mailparser @types/multer @types/jsonwebtoken
```

---

## Files Created / Modified

| File | Action |
|---|---|
| `src/api.ts` | Create — REST API router |
| `src/ingest.ts` | Modify — add `parseEml`, `parseMsg` |
| `src/tools.ts` | Modify — add `.eml`, `.msg` branches in `handleIngestFile` |
| `src/remote.ts` | Modify — mount `/api` router, serve `public/` |
| `public/index.html` | Create — full frontend |
| `.env` | Modify — add `ADMIN_PASSWORD` |
| `.env.example` | Modify — add `ADMIN_PASSWORD=` |

---

## Out of Scope

- User accounts / multi-user auth (single password only)
- Document preview / full text view
- Bulk delete
- Re-ingestion of already-indexed documents (deduplicated by content hash — silently skipped)
- Mobile-optimised layout (desktop-first, but Tailwind responsive classes used where trivial)
