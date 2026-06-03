#!/usr/bin/env npx tsx
// scripts/ingest-file.ts
import 'dotenv/config';
import { handleIngestFile } from '../src/tools.js';
import type { SourceType } from '../src/types.js';

const [,, filePath, sourceType, caseNumber, documentDate] = process.argv;

if (!filePath || !sourceType) {
  console.error('Usage: npx tsx scripts/ingest-file.ts <path> <source_type> [case_number] [date]');
  console.error('');
  console.error('source_type values:');
  console.error('  olaf_complaint | general_court | ias_audit | ep_discharge');
  console.error('  correspondence | staff_regulations | decision | other');
  console.error('');
  console.error('Example:');
  console.error('  npx tsx scripts/ingest-file.ts ./docs/olaf-complaint.pdf olaf_complaint T-777/25 2025-11-15');
  process.exit(1);
}

console.log(`[ingest] Processing: ${filePath}`);
const result = await handleIngestFile({
  file_path:     filePath,
  source_type:   sourceType as SourceType,
  case_number:   caseNumber || undefined,
  document_date: documentDate || undefined,
  language:      'en',
});
console.log(result);
