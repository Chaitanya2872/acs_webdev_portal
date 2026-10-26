/**
 * Content checks for an uploaded PDF, based on its first and last bytes (read with ranged GETs, so the file
 * never streams through the API server). Catches renamed non-PDF files and truncated/interrupted uploads.
 */
export type PdfCheckResult = { valid: true } | { valid: false; reason: string };

const HEADER_WINDOW = 1024;

export function checkPdfBytes(head: Buffer, tail: Buffer): PdfCheckResult {
  // Readers accept the header anywhere in the first 1024 bytes (ISO 32000-1, Annex H.3).
  const headerIndex = head.subarray(0, HEADER_WINDOW).indexOf('%PDF-');
  if (headerIndex === -1) {
    return { valid: false, reason: 'The file is not a PDF (missing %PDF- header).' };
  }

  const version = head.subarray(headerIndex + 5, headerIndex + 8).toString('latin1');
  if (!/^\d\.\d$/.test(version)) {
    return { valid: false, reason: 'The PDF header is malformed.' };
  }

  if (tail.indexOf('%%EOF') === -1) {
    return { valid: false, reason: 'The PDF is incomplete or corrupted (missing %%EOF marker).' };
  }

  return { valid: true };
}

export const PDF_HEAD_RANGE = `bytes=0-${HEADER_WINDOW - 1}`;
export const PDF_TAIL_RANGE = 'bytes=-2048';
