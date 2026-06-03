// src/chat.ts
import { supabase } from './supabase.js';

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

function getChatModel(): string {
  return process.env.CHAT_MODEL ?? 'deepseek/deepseek-chat-v3-0324';
}

function getOpenRouterKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('Missing OPENROUTER_API_KEY');
  return key;
}

export async function chatWithDocument(
  documentId: number,
  filename: string,
  userMessage: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<string> {
  // Fetch all chunks ordered by position
  const { data: chunks, error } = await supabase
    .from('document_chunks')
    .select('content, chunk_index')
    .eq('document_id', documentId)
    .order('chunk_index');

  if (error) throw new Error(`Failed to load document: ${error.message}`);
  if (!chunks || chunks.length === 0) throw new Error('Document has no content');

  const docContent = chunks.map((c: any) => c.content).join('\n\n');

  const systemPrompt = `You are a legal document assistant. You have been given the full content of the document "${filename}". Answer the user's questions based strictly on this document. Be precise and cite relevant passages when useful. If the answer is not in the document, say so clearly.

--- DOCUMENT START ---
${docContent}
--- DOCUMENT END ---`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage },
  ];

  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${getOpenRouterKey()}`,
    },
    body: JSON.stringify({
      model:    getChatModel(),
      messages,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter chat error (${response.status}): ${err}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
  };

  return data.choices[0]?.message?.content ?? '(no response)';
}
