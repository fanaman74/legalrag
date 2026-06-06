// tests/batch-ingest.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SourceType } from '../src/types.js';

// Mock modules before importing ingestDocument
vi.mock('../src/supabase.js', () => ({
  upsertDocument: vi.fn(async () => {
    // Simulate database behavior - return a mock document ID
    return Math.floor(Math.random() * 100000) + 1;
  }),
  insertChunks: vi.fn(async () => {
    // Simulate successful chunk insertion
    return undefined;
  }),
}));

vi.mock('../src/embeddings.js', () => ({
  embedDocument: vi.fn(async () => {
    // Return mock 1024-dimensional embedding vector
    return Array(1024).fill(0).map(() => Math.random());
  }),
  embedText: vi.fn(async () => {
    // Return mock 1024-dimensional embedding vector
    return Array(1024).fill(0).map(() => Math.random());
  }),
}));

// Import after mocking dependencies
import { ingestDocument } from '../src/ingest.js';

describe('Batch Ingest', () => {
  beforeEach(() => {
    // Clear mocks between tests
    vi.clearAllMocks();
  });

  it('should ingest document with folder_path', async () => {
    const result = await ingestDocument({
      filename: 'test.txt',
      rawText: 'This is a test document with enough content to create at least one chunk for proper processing.',
      sourceType: 'other' as SourceType,
      folder: 'Case_2024/Documents',
      language: 'en',
    });

    expect(result.documentId).toBeGreaterThan(0);
    expect(result.chunksCreated).toBeGreaterThan(0);
    expect(result.message).toContain('Successfully ingested');
  });

  it('should handle missing folder gracefully', async () => {
    const result = await ingestDocument({
      filename: 'test.txt',
      rawText: 'This is a test document with enough content to create at least one chunk for proper processing.',
      sourceType: 'other' as SourceType,
      language: 'en',
    });

    expect(result.documentId).toBeGreaterThan(0);
  });

  it('should ingest multiple documents in sequence', async () => {
    const docs = [
      { filename: 'doc1.txt', text: 'Document 1 content with meaningful text to ensure minimum chunk size requirements are met for testing purposes.' },
      { filename: 'doc2.txt', text: 'Document 2 content with meaningful text to ensure minimum chunk size requirements are met for testing purposes.' },
      { filename: 'doc3.txt', text: 'Document 3 content with meaningful text to ensure minimum chunk size requirements are met for testing purposes.' },
    ];

    const results = [];
    for (const doc of docs) {
      const result = await ingestDocument({
        filename: doc.filename,
        rawText: doc.text,
        sourceType: 'other' as SourceType,
        folder: 'batch_test',
        language: 'en',
      });
      results.push(result);
    }

    expect(results).toHaveLength(3);
    expect(results.every(r => r.documentId > 0)).toBe(true);
  });
});
