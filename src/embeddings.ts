// src/embeddings.ts

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/embeddings';
const EMBEDDING_MODEL    = 'mistralai/mistral-embed-2312'; // 1024-dimensional embeddings

function getOpenRouterKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('Missing OPENROUTER_API_KEY environment variable');
  return key;
}

async function callEmbeddingsApi(input: string): Promise<number[]> {
  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${getOpenRouterKey()}`,
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter embeddings error (${response.status}): ${err}`);
  }

  const data = await response.json() as { data: Array<{ embedding: number[] }> };
  return data.data[0].embedding;
}

/** Embed a search query (use for search_documents tool) */
export async function embedText(text: string): Promise<number[]> {
  return callEmbeddingsApi(text);
}

/** Embed a document chunk (use during ingestion) */
export async function embedDocument(text: string): Promise<number[]> {
  return callEmbeddingsApi(text);
}
