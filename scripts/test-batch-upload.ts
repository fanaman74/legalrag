// scripts/test-batch-upload.ts
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import FormData from 'form-data';

const API_URL = process.env.API_URL || 'http://localhost:8000';
const TOKEN = process.env.AUTH_TOKEN;

if (!TOKEN) {
  console.error('AUTH_TOKEN environment variable is required');
  process.exit(1);
}

async function testBatchUpload() {
  console.log('Testing batch upload endpoint...');
  const tempDir = path.join('/tmp', `batch-test-${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    for (let i = 1; i <= 3; i++) {
      const filename = path.join(tempDir, `test-doc-${i}.txt`);
      fs.writeFileSync(filename, `Test document ${i}. Date: 2024-06-0${i}. Parties: Company ${i} and Client ${i}.`);
    }

    const form = new FormData();
    for (let i = 1; i <= 3; i++) {
      form.append('files', fs.createReadStream(path.join(tempDir, `test-doc-${i}.txt`)));
    }
    form.append('source_type', 'other');
    form.append('language', 'en');

    console.log('\n1. Submitting batch...');
    const uploadRes = await fetch(`${API_URL}/api/ingest/batch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, ...form.getHeaders() },
      body: form as any,
    });

    if (!uploadRes.ok) {
      throw new Error(`Upload failed: ${uploadRes.status}`);
    }

    const batchData = (await uploadRes.json()) as any;
    console.log(`✓ Batch submitted. ID: ${batchData.batch_id}`);

    console.log('\n2. Polling status...');
    let completed = false;
    for (let poll = 0; poll < 60 && !completed; poll++) {
      await new Promise(r => setTimeout(r, 2000));

      const statusRes = await fetch(`${API_URL}/api/ingest/batch/${batchData.batch_id}/status`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });

      if (statusRes.ok) {
        const text = await statusRes.text();
        const lines = text.split('\n').filter(l => l.startsWith('data: '));
        if (lines.length > 0) {
          const data = JSON.parse(lines[lines.length - 1].replace('data: ', ''));
          console.log(`  Poll ${poll + 1}: ${data.type}`);
          if (data.type === 'complete') completed = true;
        }
      }
    }

    console.log(completed ? '✓ Batch completed!' : '⚠ Timeout');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log('\n✓ Cleanup done');
  }
}

testBatchUpload().catch(err => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
