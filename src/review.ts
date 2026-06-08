// src/review.ts
import OpenAI from 'openai';
import type { AnalysisResult } from './types.js';

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'https://github.com/fanaman74/legalrag',
    'X-Title': 'Legal RAG',
  },
});

// Constants
const MODEL_ID = 'openai/gpt-oss-120b:free';
const MAX_TOKENS = 1024;
const CONTENT_MAX_CHARS = 8000;

const REVIEW_PROMPT = `You are a legal document analyzer. Extract the following structured information from the document:
- Document type: Classify as one of: contract, complaint, court_decision, correspondence, agreement, motion, brief, memorandum, regulation, statute, other
- Parties: List all named parties, entities, or individuals involved (extract proper nouns)
- Key dates: Extract all important dates (signing date, filing date, effective date, deadline, etc.)
- Risks: Identify compliance issues, missing clauses, unusual terms, or red flags (each risk as an object with 'flag' and 'severity' (high/medium/low))
- Urgency: Rate as high/medium/low based on content (deadlines, legal jeopardy, etc.)
- Summary: One sentence summary of the document

Return ONLY valid JSON with keys: document_type, parties (array of strings), key_dates (array of YYYY-MM-DD strings), risks (array of {flag, severity}), urgency_level (string), summary (string)`;

/**
 * Review a legal document using OpenRouter GPT to extract structured information.
 * @param content - Document content (will be truncated to 8000 chars)
 * @returns Structured analysis with document type, parties, dates, risks, and urgency
 */
export async function reviewDocument(content: string): Promise<AnalysisResult> {
  try {
    const response = await client.chat.completions.create({
      model: MODEL_ID,
      max_tokens: MAX_TOKENS,
      messages: [
        {
          role: 'user',
          content: `${REVIEW_PROMPT}\n\nDocument content:\n\n${content.slice(0, CONTENT_MAX_CHARS)}`,
        },
      ],
    });

    const text = response.choices?.[0]?.message?.content ?? '';
    let analysis;
    try {
      analysis = JSON.parse(text);
    } catch {
      analysis = {}; // Fall back to empty object so defaults apply
    }

    return {
      document_type: analysis.document_type || 'other',
      parties: Array.isArray(analysis.parties) ? analysis.parties : [],
      key_dates: Array.isArray(analysis.key_dates) ? analysis.key_dates : [],
      risks: Array.isArray(analysis.risks) ? analysis.risks : [],
      urgency_level: analysis.urgency_level || 'medium',
      summary: analysis.summary || '',
      ai_model: MODEL_ID,
      reviewed_at: new Date().toISOString(),
    };
  } catch (err) {
    throw new Error(`Review failed: ${(err as Error).message}`);
  }
}
