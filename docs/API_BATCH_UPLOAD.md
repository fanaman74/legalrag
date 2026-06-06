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
