// src/api.ts
import express from 'express';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { listDocuments, deleteDocument, semanticSearch, getDocumentContent, createBatchUpload, updateBatchProgress, storeDocumentAnalysis, updateDocumentReview } from './supabase.js';
import { chatWithDocument } from './chat.js';
import { ingestDocument, parsePdf, parseDocx, parseEml, parseMsg } from './ingest.js';
import { embedText } from './embeddings.js';
import { reviewDocument } from './review.js';
import type { SourceType } from './types.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const uploadBatch = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
}).array('files', 1000); // Max 1000 files per batch

const ALLOWED_EXTS = new Set(['.pdf', '.docx', '.txt', '.md', '.eml', '.msg']);

function getSecret(): string {
  const s = process.env.ADMIN_PASSWORD;
  if (!s) throw new Error('ADMIN_PASSWORD env var is not set');
  return s;
}

// ─── Auth middleware ────────────────────────────────────────────────────────
function requireAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    jwt.verify(auth.slice(7), getSecret());
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ─── POST /api/auth ─────────────────────────────────────────────────────────
router.post('/auth', (req, res) => {
  const { password } = req.body as { password?: string };
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    res.status(401).json({ error: 'Invalid password' });
    return;
  }
  const token = jwt.sign({ sub: 'admin' }, getSecret(), { expiresIn: '24h' });
  res.json({ token });
});

// ─── GET /api/documents ─────────────────────────────────────────────────────
router.get('/documents', requireAuth, async (_req, res) => {
  try {
    const docs = await listDocuments();
    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── GET /api/documents/:id/content ────────────────────────────────────────
router.get('/documents/:id/content', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid document ID' }); return; }
  try {
    const doc = await getDocumentContent(id);
    if (!doc) { res.status(404).json({ error: 'Document not found' }); return; }
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── POST /api/documents/:id/chat ──────────────────────────────────────────
router.post('/documents/:id/chat', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid document ID' }); return; }

  const { message, filename, history } = req.body as {
    message?: string;
    filename?: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  };

  if (!message?.trim()) { res.status(400).json({ error: 'message is required' }); return; }

  try {
    const answer = await chatWithDocument(
      id,
      filename ?? `Document ${id}`,
      message.trim(),
      history ?? []
    );
    res.json({ answer });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── DELETE /api/documents/:id ──────────────────────────────────────────────
router.delete('/documents/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid document ID' });
    return;
  }
  try {
    await deleteDocument(id);
    res.json({ message: `Document ${id} deleted.` });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── POST /api/ingest ───────────────────────────────────────────────────────
router.post('/ingest', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const { source_type, folder, case_number, document_date, language } = req.body as {
    source_type?: string;
    folder?: string;
    case_number?: string;
    document_date?: string;
    language?: string;
  };

  if (!source_type) {
    res.status(400).json({ error: 'source_type is required' });
    return;
  }

  const ext = path.extname(req.file.originalname).toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) {
    res.status(400).json({ error: `Unsupported file type: ${ext}` });
    return;
  }

  try {
    const buffer = req.file.buffer;

    let rawText: string;
    if (ext === '.pdf')       rawText = await parsePdf(buffer);
    else if (ext === '.docx') rawText = await parseDocx(buffer);
    else if (ext === '.eml')  rawText = await parseEml(buffer);
    else if (ext === '.msg')  rawText = await parseMsg(buffer);
    else                      rawText = buffer.toString('utf-8');

    const result = await ingestDocument({
      filename:     req.file.originalname,
      rawText,
      sourceType:   source_type as SourceType,
      folder:       folder        || undefined,
      caseNumber:   case_number   || undefined,
      documentDate: document_date || undefined,
      language:     (language as 'en' | 'fr') ?? 'en',
    });

    res.json({
      message:       result.message,
      documentId:    result.documentId,
      chunksCreated: result.chunksCreated,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── GET /api/search ────────────────────────────────────────────────────────
router.get('/search', requireAuth, async (req, res) => {
  const { q, source_type, case_number, threshold, limit } = req.query as Record<string, string>;

  if (!q) {
    res.status(400).json({ error: 'q (query) is required' });
    return;
  }

  try {
    const queryEmbedding = await embedText(q);
    const results = await semanticSearch(queryEmbedding, {
      sourceType: source_type  || undefined,
      caseNumber: case_number  || undefined,
      threshold:  threshold    ? parseFloat(threshold) : 0.60,
      limit:      limit        ? parseInt(limit, 10)   : 8,
    });
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── Batch processing helper function ──────────────────────────────────────
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

export default router;
