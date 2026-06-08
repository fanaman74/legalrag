// tests/review.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the OpenAI SDK before importing reviewDocument
vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: vi.fn(async (params: any) => {
            // Mock response for AI review
            let mockResponse: any = {
              document_type: 'contract',
              parties: ['Company ABC', 'John Doe'],
              key_dates: ['2024-06-01', '2024-07-01'],
              risks: [{ flag: 'Risk detected', severity: 'medium' }],
              urgency_level: 'medium',
              summary: 'Employment agreement with standard terms.',
            };

            // Adjust response based on document content for risk detection test
            if (params.messages?.[0]?.content?.includes('CONFIDENTIALITY AGREEMENT')) {
              mockResponse = {
                document_type: 'agreement',
                parties: [],
                key_dates: [],
                risks: [
                  { flag: 'No limitations on liability', severity: 'high' },
                  { flag: 'Unilateral termination without notice', severity: 'high' },
                  { flag: 'Missing indemnification clause', severity: 'medium' },
                ],
                urgency_level: 'high',
                summary: 'Confidentiality agreement with significant risk factors.',
              };
            }

            // Adjust response for simple test document
            if (
              params.messages?.[0]?.content?.includes('Simple test document')
            ) {
              mockResponse = {
                document_type: 'other',
                parties: [],
                key_dates: [],
                risks: [],
                urgency_level: 'low',
                summary: 'Simple test document for review.',
              };
            }

            return {
              choices: [
                {
                  message: {
                    content: JSON.stringify(mockResponse),
                  },
                },
              ],
            };
          }),
        },
      };
    },
  };
});

// Import after mocking dependencies
import { reviewDocument } from '../src/review.js';

describe('AI Review', () => {
  beforeEach(() => {
    // Clear mocks between tests
    vi.clearAllMocks();
  });

  it('should extract document type from legal text', async () => {
    const text = `
      EMPLOYMENT CONTRACT

      This Agreement is entered into between Company ABC ("Employer") and John Doe ("Employee").
      Effective Date: June 1, 2024.

      Terms:
      1. Position: Senior Developer
      2. Salary: $150,000 per year
      3. Start Date: July 1, 2024
      4. Termination: Either party may terminate with 30 days notice.
    `;

    const result = await reviewDocument(text);

    expect(result.document_type).toBeDefined();
    expect(result.parties).toContain('Company ABC');
    expect(result.parties).toContain('John Doe');
    expect(result.key_dates).toContain('2024-06-01');
    expect(result.urgency_level).toBeDefined();
    expect(['high', 'medium', 'low']).toContain(result.urgency_level);
  });

  it('should identify risks in contracts', async () => {
    const text = `
      CONFIDENTIALITY AGREEMENT

      This NDA binds both parties in perpetuity. No limitations on liability.
      Unilateral termination at will without notice.
      No indemnification clause.
    `;

    const result = await reviewDocument(text);

    expect(result.risks).toBeInstanceOf(Array);
    expect(result.risks.length).toBeGreaterThan(0);
    expect(result.risks[0]).toHaveProperty('flag');
    expect(result.risks[0]).toHaveProperty('severity');
  });

  it('should return valid AnalysisResult structure', async () => {
    const text = 'Simple test document for review.';
    const result = await reviewDocument(text);

    expect(result).toHaveProperty('document_type');
    expect(result).toHaveProperty('parties');
    expect(result).toHaveProperty('key_dates');
    expect(result).toHaveProperty('risks');
    expect(result).toHaveProperty('urgency_level');
    expect(result).toHaveProperty('ai_model');
    expect(result).toHaveProperty('reviewed_at');
  });
});
