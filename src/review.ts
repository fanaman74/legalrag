// src/review.ts
import Anthropic from '@anthropic-ai/sdk';
import type { AnalysisResult } from './types.js';

const client = new Anthropic();

const REVIEW_PROMPT = `You are a legal document analyzer. Extract the following structured information from the document:
- Document type: Classify as one of: contract, complaint, court_decision, correspondence, agreement, motion, brief, memorandum, regulation, statute, other
- Parties: List all named parties, entities, or individuals involved (extract proper nouns)
- Key dates: Extract all important dates (signing date, filing date, effective date, deadline, etc.)
- Risks: Identify compliance issues, missing clauses, unusual terms, or red flags (each risk as an object with 'flag' and 'severity' (high/medium/low))
- Urgency: Rate as high/medium/low based on content (deadlines, legal jeopardy, etc.)
- Summary: One sentence summary of the document

Return ONLY valid JSON with keys: document_type, parties (array of strings), key_dates (array of YYYY-MM-DD strings), risks (array of {flag, severity}), urgency_level (string), summary (string)`;

export async function reviewDocument(content: string): Promise<AnalysisResult> {
  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `${REVIEW_PROMPT}\n\nDocument content:\n\n${content.slice(0, 8000)}`,
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const analysis = JSON.parse(text);

    return {
      document_type: analysis.document_type || 'other',
      parties: Array.isArray(analysis.parties) ? analysis.parties : [],
      key_dates: Array.isArray(analysis.key_dates) ? analysis.key_dates : [],
      risks: Array.isArray(analysis.risks) ? analysis.risks : [],
      urgency_level: analysis.urgency_level || 'medium',
      summary: analysis.summary || '',
      ai_model: 'claude-opus-4-8',
      reviewed_at: new Date().toISOString(),
    };
  } catch (err) {
    throw new Error(`Review failed: ${(err as Error).message}`);
  }
}
