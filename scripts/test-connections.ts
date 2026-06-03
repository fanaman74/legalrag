// scripts/test-connections.ts
import 'dotenv/config';
import { embedText } from '../src/embeddings.js';
import { listDocuments } from '../src/supabase.js';

async function main() {
  console.log('Testing Voyage AI embedding...');
  try {
    const embedding = await embedText('hello');
    console.log(`Voyage AI SUCCESS. Embedding dimension: ${embedding.length}`);
  } catch (err: any) {
    console.error('Voyage AI FAILURE:', err.message);
  }

  console.log('Testing Supabase query...');
  try {
    const docs = await listDocuments();
    console.log(`Supabase SUCCESS. Found ${docs.length} documents.`);
    if (docs.length > 0) {
      console.log('First document:', docs[0]);
    }
  } catch (err: any) {
    console.error('Supabase FAILURE:', err.message);
  }
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
