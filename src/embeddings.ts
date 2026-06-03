// src/embeddings.ts

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_MODEL   = 'voyage-3-large'; // 1024-dimensional embeddings

function getVoyageKey(): string {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error('Missing VOYAGE_API_KEY environment variable');
  return key;
}

async function callVoyageApi(input: string, inputType: 'query' | 'document'): Promise<number[]> {
  const response = await fetch(VOYAGE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${getVoyageKey()}`,
    },
    body: JSON.stringify({ model: VOYAGE_MODEL, input, input_type: inputType }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Voyage AI API error (${response.status}): ${err}`);
  }

  const data = await response.json() as { data: Array<{ embedding: number[] }> };
  return data.data[0].embedding;
}

/** Embed a search query (use for search_documents tool) */
export async function embedText(text: string): Promise<number[]> {
  return callVoyageApi(text, 'query');
}

/** Embed a document chunk (use during ingestion) */
export async function embedDocument(text: string): Promise<number[]> {
  return callVoyageApi(text, 'document');
}
