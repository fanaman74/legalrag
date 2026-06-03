// src/remote.ts
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  searchDocumentsSchema, handleSearchDocuments,
  ingestTextSchema,      handleIngestText,
  ingestFileSchema,      handleIngestFile,
  deleteDocumentSchema,  handleDeleteDocument,
  handleListDocuments,
} from './tools.js';
import apiRouter from './api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ─── REST API ────────────────────────────────────────────────────────────────
app.use('/api', apiRouter);

// ─── Health check (must be before catch-all) ─────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// ─── Static frontend ─────────────────────────────────────────────────────────
app.use(express.static(join(__dirname, '..', 'public')));
app.get('/{*path}', (req, res) => {
  if (
    !req.path.startsWith('/api') &&
    !req.path.startsWith('/sse') &&
    !req.path.startsWith('/messages')
  ) {
    res.sendFile(join(__dirname, '..', 'public', 'index.html'));
  }
});

// ─── MCP / SSE ───────────────────────────────────────────────────────────────
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
  const sessionId = req.query['sessionId'] as string;
  const transport = sessions.get(sessionId);
  if (!transport) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  await transport.handlePostMessage(req, res);
});

const port = process.env.PORT ?? 3000;
app.listen(port, () => console.log(`[legal-doc-rag] HTTP MCP server on :${port}`));
