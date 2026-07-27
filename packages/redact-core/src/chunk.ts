type TextChunk = { offset: number; text: string };

const chunkText = (text: string, size = 4000, overlap = 200): Array<TextChunk> => {
  if (overlap >= size) {
    throw new RangeError(`chunk overlap (${overlap}) must be smaller than size (${size})`);
  }

  if (text.length === 0) {
    return [];
  }

  const stride = size - overlap;
  const chunks: Array<TextChunk> = [];

  for (let offset = 0; offset < text.length; offset += stride) {
    chunks.push({ offset, text: text.slice(offset, offset + size) });

    if (offset + size >= text.length) {
      break;
    }
  }

  return chunks;
};

export { chunkText };
export type { TextChunk };
