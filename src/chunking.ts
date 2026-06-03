// src/chunking.ts

export interface Chunk {
  content: string;
  tokenCount: number;
}

const CHUNK_SIZE    = 800;  // target tokens per chunk
const CHUNK_OVERLAP = 100;  // overlap tokens between chunks

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function splitBySections(text: string): string[] {
  const sectionPattern = /(?=\n(?:Article|Section|CHAPTER|Annex|ANNEX|\d+\.|[IVX]+\.)\s)/g;
  const sections = text.split(sectionPattern).filter(s => s.trim().length > 0);
  return sections;
}

function splitByParagraphs(text: string): string[] {
  return text.split(/\n{2,}/).filter(p => p.trim().length > 0);
}

export function chunkText(text: string): Chunk[] {
  const chunks: Chunk[] = [];
  const sections = splitBySections(text);

  for (const section of sections) {
    const tokenCount = estimateTokens(section);

    if (tokenCount <= CHUNK_SIZE) {
      chunks.push({ content: section.trim(), tokenCount });
    } else {
      const paragraphs = splitByParagraphs(section);
      let currentChunk  = '';
      let currentTokens = 0;

      for (const para of paragraphs) {
        const paraTokens = estimateTokens(para);

        // If a single paragraph exceeds CHUNK_SIZE, split it by sentences/words
        if (paraTokens > CHUNK_SIZE) {
          // Flush any accumulated chunk first
          if (currentChunk.trim()) {
            chunks.push({ content: currentChunk.trim(), tokenCount: currentTokens });
            const overlapText = currentChunk.slice(-(CHUNK_OVERLAP * 4));
            currentChunk  = overlapText;
            currentTokens = estimateTokens(currentChunk);
          }
          // Split large paragraph into fixed-size windows
          const chunkSizeChars = CHUNK_SIZE * 4;
          const overlapChars   = CHUNK_OVERLAP * 4;
          let pos = 0;
          while (pos < para.length) {
            const slice = para.slice(pos, pos + chunkSizeChars);
            if (slice.trim()) {
              const combined = currentChunk
                ? currentChunk + '\n\n' + slice
                : slice;
              chunks.push({ content: combined.trim(), tokenCount: estimateTokens(combined) });
            }
            pos += chunkSizeChars - overlapChars;
            // Set overlap as the start of the next currentChunk
            currentChunk  = para.slice(Math.max(0, pos - overlapChars), pos);
            currentTokens = estimateTokens(currentChunk);
          }
          currentChunk  = '';
          currentTokens = 0;
        } else if (currentTokens + paraTokens > CHUNK_SIZE && currentChunk.length > 0) {
          chunks.push({ content: currentChunk.trim(), tokenCount: currentTokens });

          const overlapText = currentChunk.slice(-(CHUNK_OVERLAP * 4));
          currentChunk  = overlapText + '\n\n' + para;
          currentTokens = estimateTokens(currentChunk);
        } else {
          currentChunk  += (currentChunk ? '\n\n' : '') + para;
          currentTokens += paraTokens;
        }
      }

      if (currentChunk.trim()) {
        chunks.push({ content: currentChunk.trim(), tokenCount: currentTokens });
      }
    }
  }

  return chunks.filter(c => c.content.length > 50);
}
