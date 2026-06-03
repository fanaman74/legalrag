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
