// scripts/reembed.ts
// Re-embeds all existing document chunks using the current embedding model.
// Run after switching embedding providers: npx tsx scripts/reembed.ts

import 'dotenv/config';
import { supabase } from '../src/supabase.js';
import { embedDocument } from '../src/embeddings.js';

const BATCH = 5; // parallel embeds per round (stay within rate limits)

async function main() {
  // Count total chunks
  const { count, error: countErr } = await supabase
    .from('document_chunks')
    .select('*', { count: 'exact', head: true });

  if (countErr) throw new Error(`Count failed: ${countErr.message}`);
  console.log(`Found ${count} chunks to re-embed.\n`);

  let offset  = 0;
  let updated = 0;
  let failed  = 0;

  while (offset < (count ?? 0)) {
    const { data: chunks, error } = await supabase
      .from('document_chunks')
      .select('id, content')
      .range(offset, offset + BATCH - 1);

    if (error) throw new Error(`Fetch failed at offset ${offset}: ${error.message}`);
    if (!chunks || chunks.length === 0) break;

    await Promise.all(chunks.map(async chunk => {
      try {
        const embedding = await embedDocument(chunk.content);
        const { error: upErr } = await supabase
          .from('document_chunks')
          .update({ embedding })
          .eq('id', chunk.id);
        if (upErr) throw new Error(upErr.message);
        process.stdout.write(`  ✓ chunk ${chunk.id}\n`);
        updated++;
      } catch (err: any) {
        process.stdout.write(`  ✗ chunk ${chunk.id}: ${err.message}\n`);
        failed++;
      }
    }));

    offset += BATCH;
    const pct = Math.min(100, Math.round((offset / (count ?? 1)) * 100));
    console.log(`Progress: ${pct}% (${Math.min(offset, count ?? 0)}/${count})`);
  }

  console.log(`\nDone. ${updated} updated, ${failed} failed.`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
