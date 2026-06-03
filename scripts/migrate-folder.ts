import 'dotenv/config';
import { supabase } from '../src/supabase.js';

const { error } = await supabase.from('documents').select('folder').limit(1);

if (error && error.message.includes('folder')) {
  console.log('Column "folder" is missing.');
  console.log('Run this in the Supabase SQL Editor:\n');
  console.log('ALTER TABLE documents ADD COLUMN IF NOT EXISTS folder TEXT;');
  console.log('CREATE INDEX IF NOT EXISTS idx_documents_folder ON documents (folder);');
} else {
  console.log('✓ folder column exists.');
}
