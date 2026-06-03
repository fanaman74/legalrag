// tests/ingest-parsers.test.ts
import { describe, it, expect } from 'vitest';
import { parseEml, parseMsg } from '../src/ingest.js';

describe('parseEml', () => {
  it('extracts from, to, subject and body from a plain-text EML', async () => {
    const eml = [
      'From: Alice <alice@example.com>',
      'To: Bob <bob@example.com>',
      'Date: Thu, 15 Nov 2025 10:00:00 +0000',
      'Subject: Contract Review',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Please review the attached contract by Friday.',
    ].join('\r\n');

    const text = await parseEml(Buffer.from(eml));
    expect(text).toContain('alice@example.com');
    expect(text).toContain('bob@example.com');
    expect(text).toContain('Contract Review');
    expect(text).toContain('Please review the attached contract');
  });

  it('falls back to stripping HTML when no plain-text part', async () => {
    const eml = [
      'From: sender@example.com',
      'To: recipient@example.com',
      'Subject: HTML Only',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<html><body><p>HTML body content here</p></body></html>',
    ].join('\r\n');

    const text = await parseEml(Buffer.from(eml));
    expect(text).toContain('HTML body content here');
  });

  it('output starts with From: line', async () => {
    const eml = [
      'From: sender@example.com',
      'To: recipient@example.com',
      'Subject: Test',
      'Content-Type: text/plain',
      '',
      'Body text.',
    ].join('\r\n');

    const text = await parseEml(Buffer.from(eml));
    expect(text.startsWith('From:')).toBe(true);
  });
});

describe('parseMsg', () => {
  it('returns a string for any buffer input', async () => {
    const badBuffer = Buffer.from('this is not a msg file');
    const result = await parseMsg(badBuffer);
    expect(typeof result).toBe('string');
  });
});
