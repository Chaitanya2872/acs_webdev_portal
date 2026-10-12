import { describe, expect, it } from 'vitest';
import { normalizeFileName, normalizeFolderName } from '../../src/utils/filename';
import { buildS3Key } from '../../src/utils/s3-key';

describe('folder validation', () => {
  it('accepts valid folder names', () => {
    expect(() => normalizeFolderName('documents')).not.toThrow();
    expect(() => normalizeFolderName('documents/2026')).not.toThrow();
  });

  it('rejects traversal and absolute folder names', () => {
    expect(() => normalizeFolderName('../documents')).toThrow('INVALID_FOLDER_NAME');
    expect(() => normalizeFolderName('/documents')).toThrow('INVALID_FOLDER_NAME');
    expect(() => normalizeFolderName('..')).toThrow('INVALID_FOLDER_NAME');
  });

  it('accepts valid file names and rejects unsafe ones', () => {
    expect(() => normalizeFileName('report.pdf')).not.toThrow();
    expect(() => normalizeFileName('../report.pdf')).toThrow('INVALID_FILE_NAME');
    expect(() => normalizeFileName('bad/filename.pdf')).toThrow('INVALID_FILE_NAME');
  });

  it('builds a safe S3 key', () => {
    expect(buildS3Key('documents', 'report.pdf')).toBe('documents/report.pdf');
  });
});
