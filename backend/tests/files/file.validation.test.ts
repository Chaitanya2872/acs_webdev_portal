import { describe, expect, it } from 'vitest';
import { FileService } from '../../src/modules/files/file.service';
import { S3Service } from '../../src/services/s3.service';

describe('file validation', () => {
  it('rejects unsupported file types', async () => {
    const service = new FileService(new S3Service({ send: async () => ({}) } as any, 'demo-bucket', 900));
    await expect(
      service.createUploadRequest({ folderName: 'documents', fileName: 'report.bin', contentType: 'application/x-unsupported', fileSize: 1024 })
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE' });
  });

  it('rejects oversized files', async () => {
    const service = new FileService(new S3Service({ send: async () => ({}) } as any, 'demo-bucket', 900));
    await expect(
      service.createUploadRequest({ folderName: 'documents', fileName: 'report.pdf', contentType: 'application/pdf', fileSize: 200000000 })
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });

  it('rejects invalid names and path traversal', async () => {
    const service = new FileService(new S3Service({ send: async () => ({}) } as any, 'demo-bucket', 900));
    await expect(
      service.createUploadRequest({ folderName: '../docs', fileName: 'report.pdf', contentType: 'application/pdf', fileSize: 1000 })
    ).rejects.toMatchObject({ code: 'INVALID_FOLDER_NAME' });

    await expect(
      service.createUploadRequest({ folderName: 'documents', fileName: '../report.pdf', contentType: 'application/pdf', fileSize: 1000 })
    ).rejects.toMatchObject({ code: 'INVALID_FILE_NAME' });
  });
});
