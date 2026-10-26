import { describe, expect, it } from 'vitest';
import {
  buildDocumentObjectKey,
  financialYearForDate,
  isValidFinancialYear,
  isWithinPrefix,
  sanitizeDisplayFilename,
  slugifyFilename,
  uuidV5,
} from '../../src/utils/document-key';
import { checkPdfBytes } from '../../src/utils/pdf';
import { buildContentDisposition } from '../../src/services/s3.service';
import { inferDocumentDate, inferFinancialYear } from '../../src/modules/documents/legacy-migration';
import { normalizeLegacyPath } from '../../src/modules/documents/public-document.service';
import { makePdf } from './helpers';

describe('display filenames', () => {
  it('keeps spaces, punctuation and Unicode but strips paths and control characters', () => {
    expect(sanitizeDisplayFilename('WHISTLEBLOWER  POLICY(1).pdf')).toBe('WHISTLEBLOWER POLICY(1).pdf');
    expect(sanitizeDisplayFilename('Outcome of Board Meeting – 13 August 2026.pdf')).toBe('Outcome of Board Meeting – 13 August 2026.pdf');
    expect(sanitizeDisplayFilename('..\\..\\etc/passwd.pdf')).toBe('passwd.pdf');
    expect(sanitizeDisplayFilename('report\u0000\u0007.pdf')).toBe('report.pdf');
    expect(sanitizeDisplayFilename('वार्षिक रिपोर्ट.PDF')).toBe('वार्षिक रिपोर्ट.pdf');
    expect(sanitizeDisplayFilename('notes')).toBe('notes.pdf');
  });

  it('rejects names with nothing left after cleaning', () => {
    expect(() => sanitizeDisplayFilename('   ')).toThrow('INVALID_FILE_NAME');
    expect(() => sanitizeDisplayFilename('.pdf')).toThrow('INVALID_FILE_NAME');
    expect(() => sanitizeDisplayFilename('../')).toThrow('INVALID_FILE_NAME');
  });
});

describe('object keys', () => {
  const documentId = '0b6c1c55-3f3c-4c9a-9a38-0f0a4c7b9d11';

  it('slugifies to ASCII and falls back for non-Latin names', () => {
    expect(slugifyFilename('Outcome of Board Meeting – 13 August 2026.pdf')).toBe('outcome-of-board-meeting-13-august-2026');
    expect(slugifyFilename('Résumé (final).pdf')).toBe('resume-final');
    expect(slugifyFilename('वार्षिक.pdf')).toBe('document');
  });

  it('builds category / period / document / version keys', () => {
    expect(buildDocumentObjectKey({
      documentsPrefix: 'corporate-documents',
      categoryPrefix: 'stock-exchange-filings/board-meetings/outcomes',
      financialYear: '2026-27',
      documentId,
      version: 2,
      fileName: 'Outcome of BM.pdf',
    })).toBe(`corporate-documents/stock-exchange-filings/board-meetings/outcomes/2026-27/${documentId}/v2-outcome-of-bm.pdf`);

    expect(buildDocumentObjectKey({ documentsPrefix: 'corporate-documents', categoryPrefix: 'annual-reports', documentDate: '2026-09-01', documentId, version: 1, fileName: 'a.pdf' }))
      .toContain('/annual-reports/2026/');
    expect(buildDocumentObjectKey({ documentsPrefix: 'corporate-documents', categoryPrefix: 'annual-reports', documentId, version: 1, fileName: 'a.pdf' }))
      .toContain('/annual-reports/undated/');
  });

  it('refuses unsafe prefixes and ids', () => {
    expect(() => buildDocumentObjectKey({ documentsPrefix: '../x', categoryPrefix: 'a', documentId, version: 1, fileName: 'a.pdf' })).toThrow();
    expect(() => buildDocumentObjectKey({ documentsPrefix: 'x', categoryPrefix: 'a', documentId: '../../etc', version: 1, fileName: 'a.pdf' })).toThrow();
    expect(() => buildDocumentObjectKey({ documentsPrefix: 'x', categoryPrefix: 'a', financialYear: '../', documentId, version: 1, fileName: 'a.pdf' })).toThrow();
  });

  it('detects keys inside the managed prefix', () => {
    expect(isWithinPrefix('corporate-documents/annual-reports/x.pdf', 'corporate-documents')).toBe(true);
    expect(isWithinPrefix('corporate-documents', 'corporate-documents')).toBe(true);
    expect(isWithinPrefix('corporate-documents-old/x.pdf', 'corporate-documents')).toBe(false);
  });

  it('generates stable v5 UUIDs', () => {
    const first = uuidV5('/assets/docs/Annual Reports/Annual Report 2026.pdf', '6f1c2f4e-3b0a-4f3e-9a51-8d1f0c6e2b7a');
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidV5('/assets/docs/Annual Reports/Annual Report 2026.pdf', '6f1c2f4e-3b0a-4f3e-9a51-8d1f0c6e2b7a')).toBe(first);
    // RFC 4122 test vector (DNS namespace, "www.example.com").
    expect(uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });
});

describe('financial years', () => {
  it('follows the April-March Indian financial year', () => {
    expect(financialYearForDate('2026-03-31')).toBe('2025-26');
    expect(financialYearForDate('2026-04-01')).toBe('2026-27');
    expect(financialYearForDate('2099-12-01')).toBe('2099-00');
    expect(isValidFinancialYear('2025-26')).toBe(true);
    expect(isValidFinancialYear('2025-27')).toBe(false);
    expect(isValidFinancialYear('25-26')).toBe(false);
  });
});

describe('PDF content checks', () => {
  it('accepts a complete PDF', () => {
    const pdf = makePdf();
    expect(checkPdfBytes(pdf.subarray(0, 1024), pdf.subarray(-2048))).toEqual({ valid: true });
  });

  it('rejects renamed files, malformed headers and truncated uploads', () => {
    const html = Buffer.from('<html>not a pdf</html>');
    expect(checkPdfBytes(html, html).valid).toBe(false);
    const badVersion = Buffer.from('%PDF-x.y\n%%EOF');
    expect(checkPdfBytes(badVersion, badVersion).valid).toBe(false);
    const truncated = makePdf().subarray(0, 40);
    expect(checkPdfBytes(truncated, truncated)).toMatchObject({ valid: false, reason: expect.stringContaining('incomplete') });
  });
});

describe('content disposition', () => {
  it('provides an ASCII fallback and a UTF-8 filename*', () => {
    expect(buildContentDisposition('inline', 'Outcome – 13 Aug.pdf')).toBe(`inline; filename="Outcome  13 Aug.pdf"; filename*=UTF-8''Outcome%20%E2%80%93%2013%20Aug.pdf`);
    expect(buildContentDisposition('attachment', 'a"b.pdf')).toContain('filename="ab.pdf"');
  });
});

describe('legacy metadata inference', () => {
  it.each([
    ['Outcome of Board Meeting 13 Aug 2026', '2026-08-13'],
    ['Announcement under Regulation 30 (LODR) 03rd Jul 2026', '2026-07-03'],
    ['Closure of Trading Window 29th Sep 2025', '2025-09-29'],
    ['Press Release Mar 31 2026- Exclusive agreement', '2026-03-31'],
    ['Outcome of Board Meeting 03.07.2026.pdf', '2026-07-03'],
    ['Board Meeting Outcome 26Aug2025.pdf', '2025-08-26'],
    ['Announcement under Regulation 30(LODR) 26h Aug 2025', '2025-08-26'],
    ['Intimation of board meeting on 13th AUG', null],
    ['Annual Report 2026', null],
    ['Outcome 31st Feb 2025', null],
  ])('%s → %s', (title, expected) => {
    expect(inferDocumentDate(title)).toBe(expected);
  });

  it('prefers an explicit financial year over the date', () => {
    expect(inferFinancialYear('Annual Secretarial Compliance Report 2025-26', null)).toBe('2025-26');
    expect(inferFinancialYear('Newspaper Publication for Q1 FY2026-27', '2026-08-14')).toBe('2026-27');
    expect(inferFinancialYear('Outcome', '2026-02-10')).toBe('2025-26');
    expect(inferFinancialYear('Annual Report 2026', null)).toBeNull();
  });
});

describe('legacy paths', () => {
  it('normalizes encoded and absolute URLs under /assets/docs/', () => {
    expect(normalizeLegacyPath('/assets/docs/Annual%20Reports/Annual%20Report%202026.pdf')).toBe('/assets/docs/Annual Reports/Annual Report 2026.pdf');
    expect(normalizeLegacyPath('https://www.acstechnologies.co.in/assets/docs/Code of Conduct/a.pdf')).toBe('/assets/docs/Code of Conduct/a.pdf');
    expect(normalizeLegacyPath('assets/docs/x.pdf')).toBe('/assets/docs/x.pdf');
  });

  it('rejects anything else', () => {
    expect(normalizeLegacyPath('/etc/passwd')).toBeNull();
    expect(normalizeLegacyPath('/assets/docs/../../.env')).toBeNull();
    expect(normalizeLegacyPath('%E0%A4%A')).toBeNull();
  });
});
