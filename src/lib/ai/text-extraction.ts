export function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/ +/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function chunkText(
  text: string,
  chunkSize: number = 1000,
  overlap: number = 200
): string[] {
  if (text.length <= chunkSize) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = start + chunkSize;

    if (end < text.length) {
      const lastSpace = text.lastIndexOf(' ', end);
      if (lastSpace > start) {
        end = lastSpace;
      }
    }

    chunks.push(text.slice(start, end).trim());
    start = end - overlap;
  }

  return chunks.filter((chunk) => chunk.length > 0);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

export async function extractFromPDF(buffer: Buffer): Promise<string> {
  try {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await withTimeout(parser.getText(), 30_000, 'pdf-parse getText');
    await parser.destroy();
    if (result.text && result.text.trim().length > 10) {
      return normalizeText(result.text);
    }
  } catch {
    // pdf-parse failed (likely worker issue) — fall through to raw extraction
  }

  // Fallback: extract readable text from the PDF binary using multiple strategies
  const buf = buffer.toString('latin1');
  const parts: string[] = [];

  // Strategy 1: Extract text between BT/ET text operators (PDF text blocks)
  const btEtMatches = buf.match(/BT[\s\S]*?ET/g) || [];
  for (const block of btEtMatches) {
    const strings = block.match(/\(([^)]+)\)/g) || [];
    for (const s of strings) {
      const cleaned = s.slice(1, -1)
        .replace(/\\n/g, ' ')
        .replace(/\\r/g, ' ')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\');
      if (cleaned.trim().length > 0) parts.push(cleaned);
    }
  }

  // Strategy 2: If nothing found, try broader string extraction
  if (parts.length === 0) {
    const allStrings = buf.match(/\(([^)]{3,})\)/g) || [];
    for (const s of allStrings) {
      const cleaned = s.slice(1, -1).replace(/\\\(/g, '(').replace(/\\\)/g, ')');
      if (/[\x20-\x7E]{3,}/.test(cleaned)) parts.push(cleaned);
    }
  }

  return normalizeText(parts.join(' '));
}

export async function extractFromDOCX(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  return normalizeText(result.value);
}

export async function extractFromTXT(buffer: Buffer): Promise<string> {
  return normalizeText(buffer.toString('utf-8'));
}

export async function extractText(
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  switch (mimeType) {
    case 'application/pdf':
      return extractFromPDF(buffer);
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return extractFromDOCX(buffer);
    case 'text/plain':
    case 'text/markdown':
      return extractFromTXT(buffer);
    default:
      throw new Error(`Unsupported MIME type: ${mimeType}`);
  }
}
