import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://example.com/presigned-url'),
}));

import { S3Service } from '../../src/services/s3.service';

describe('S3 service', () => {
  const sendMock = vi.fn();
  const client = { send: sendMock } as any;
  const service = new S3Service(client, 'demo-bucket', 900);

  beforeEach(() => {
    sendMock.mockReset();
  });

  it('creates a folder marker when it does not already exist', async () => {
    sendMock
      .mockRejectedValueOnce(Object.assign(new Error('NotFound'), { $metadata: { httpStatusCode: 404 } }))
      .mockResolvedValueOnce({});

    const result = await service.ensureFolder('documents');

    expect(result).toEqual({ folderName: 'documents' });
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('lists files without folder markers and ignores nested files in a direct folder listing', async () => {
    sendMock.mockResolvedValue({
      Contents: [
        { Key: 'documents/report.pdf', Size: 1024, LastModified: new Date('2026-10-07T09:30:00.000Z'), ContentType: 'application/pdf' },
        { Key: 'documents/subdir/summary.pdf', Size: 2048, LastModified: new Date('2026-10-07T09:32:00.000Z'), ContentType: 'application/pdf' },
        { Key: 'documents/', Size: 0, LastModified: new Date('2026-10-07T09:31:00.000Z') },
      ],
    });

    const result = await service.listFiles('documents');

    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({ key: 'documents/report.pdf', fileName: 'report.pdf' });
  });

  it('returns a presigned upload URL', async () => {
    const result = await service.generateUploadUrl('documents/report.pdf', 'application/pdf', 900);

    expect(result).toMatchObject({ key: 'documents/report.pdf', expiresIn: 900 });
    expect(result.uploadUrl).toBe('https://example.com/presigned-url');
  });

  it('renames by copying then deleting the original object', async () => {
    sendMock
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});

    const result = await service.replaceFile('documents/report.pdf', 'documents/final-report.pdf', 'application/pdf');

    expect(result).toMatchObject({ key: 'documents/final-report.pdf' });
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it('detects missing objects', async () => {
    sendMock.mockRejectedValueOnce(Object.assign(new Error('NotFound'), { $metadata: { httpStatusCode: 404 } }));

    await expect(service.objectExists('missing.txt')).resolves.toBe(false);
  });
});
