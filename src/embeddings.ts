// src/embeddings.ts
import { env, pipeline } from '@xenova/transformers';

// Use ONNX models that run locally
env.allowLocalModels = true;
env.allowRemoteModels = true;

// Cache the model to avoid re-initializing on every call
let embeddingPipeline: Awaited<ReturnType<typeof pipeline>> | null = null;

/**
 * Initialize the embedding model (lazy-loaded on first use)
 * Uses Xenova/all-MiniLM-L6-v2: 384-dimensional embeddings, fast and lightweight
 */
async function getEmbeddingPipeline() {
  if (!embeddingPipeline) {
    console.error('[embeddings] Loading Transformers.js model (this may take a moment on first run)...');
    embeddingPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.error('[embeddings] Model loaded successfully');
  }
  return embeddingPipeline;
}

/**
 * Convert text to embedding vector using local Transformers.js model
 * Returns 384-dimensional vector
 */
async function getEmbedding(text: string): Promise<number[]> {
  try {
    const extractor = await getEmbeddingPipeline();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (extractor as any)(text, { pooling: 'mean', normalize: true });

    // Convert to plain number array
    const embedding = Array.from(result.data as ArrayLike<number>);
    return embedding as number[];
  } catch (err) {
    throw new Error(`Embedding generation failed: ${(err as Error).message}`);
  }
}

/** Embed a search query (use for search_documents tool) */
export async function embedText(text: string): Promise<number[]> {
  return getEmbedding(text);
}

/** Embed a document chunk (use during ingestion) */
export async function embedDocument(text: string): Promise<number[]> {
  return getEmbedding(text);
}
