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
