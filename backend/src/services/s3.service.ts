import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client } from '../config/aws';
import { env } from '../config/env';
import { normalizeFolderName } from '../utils/filename';
import { toFolderMarker } from '../utils/s3-key';
import { AppError } from '../utils/response';

export type S3FileSummary = {
  key: string;
  fileName: string;
  size: number;
  contentType: string;
  lastModified: string;
};

export class S3Service {
  constructor(
    private readonly client: S3Client = s3Client,
    private readonly bucketName: string = env.S3_BUCKET_NAME,
    private readonly expirationSeconds: number = env.PRESIGNED_URL_EXPIRATION,
  ) {}

  private getFolderKey(folderName: string): string {
    return toFolderMarker(folderName);
  }

  private toFileSummary(item: { Key?: string; Size?: number; LastModified?: Date; ContentType?: string } | null): S3FileSummary | null {
    if (!item || !item.Key || item.Key.endsWith('/')) {
      return null;
    }

    const key = item.Key;
    return {
      key,
      fileName: key.split('/').pop() ?? key,
      size: item.Size ?? 0,
      contentType: item.ContentType ?? 'application/octet-stream',
      lastModified: item.LastModified ? item.LastModified.toISOString() : new Date().toISOString(),
    };
  }

  private handleS3Error(error: unknown, fallbackCode: string, fallbackMessage: string): never {
    const metadata = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata;
    const httpStatusCode = metadata?.httpStatusCode;

    if (httpStatusCode === 404 || (error as { name?: string })?.name === 'NotFound') {
      throw new AppError('FILE_NOT_FOUND', 'The requested file was not found.', 404);
    }

    if (httpStatusCode === 409 || (error as { name?: string })?.name === 'Conflict') {
      throw new AppError('FILE_ALREADY_EXISTS', 'A file with this name already exists in the folder.', 409);
    }

    if (httpStatusCode === 413) {
      throw new AppError('FILE_TOO_LARGE', 'The file exceeds the configured size limit.', 413);
    }

    if (httpStatusCode === 415 || (error as { name?: string })?.name === 'UnsupportedMediaType') {
      throw new AppError('UNSUPPORTED_FILE_TYPE', 'The file type is not supported.', 415);
    }

    throw new AppError(fallbackCode, fallbackMessage, 500);
  }

  async ensureFolder(folderName: string): Promise<{ folderName: string }> {
    const folder = normalizeFolderName(folderName);
    const folderKey = this.getFolderKey(folder);

    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucketName, Key: folderKey }));
      return { folderName: folder };
    } catch (error) {
      const httpStatusCode = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (httpStatusCode === 404) {
        try {
          await this.client.send(new PutObjectCommand({ Bucket: this.bucketName, Key: folderKey, Body: '', ContentType: 'application/x-directory' }));
          return { folderName: folder };
        } catch (putError) {
          this.handleS3Error(putError, 'S3_ERROR', 'Unable to create the folder in S3.');
        }
      }
      this.handleS3Error(error, 'S3_ERROR', 'Unable to access the folder in S3.');
    }
  }

  private async listObjectKeys(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const response = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }));
      keys.push(...(response.Contents ?? []).flatMap((item) => item.Key ? [item.Key] : []));
      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return keys;
  }

  async listSubfolders(folderName: string): Promise<Array<{ folderName: string }>> {
    const folder = normalizeFolderName(folderName);

    try {
      const response = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: `${folder}/`,
        Delimiter: '/',
      }));
      return (response.CommonPrefixes ?? [])
        .map((item) => item.Prefix)
        .filter((prefix): prefix is string => Boolean(prefix))
        .map((prefix) => ({ folderName: prefix.replace(/\/$/, '') }));
    } catch (error) {
      this.handleS3Error(error, 'S3_ERROR', 'Unable to list subfolders in S3.');
    }
  }

  async renameFolder(currentFolderName: string, nextFolderName: string): Promise<{ folderName: string }> {
    const current = normalizeFolderName(currentFolderName);
    const next = normalizeFolderName(nextFolderName);
    const currentPrefix = `${current}/`;
    const nextPrefix = `${next}/`;

    if (current === next) return { folderName: next };
    if (next.startsWith(currentPrefix)) {
      throw new AppError('INVALID_FOLDER_NAME', 'A folder cannot be moved inside itself.', 400);
    }

    try {
      const destinationKeys = await this.listObjectKeys(nextPrefix);
      if (destinationKeys.length > 0) {
        throw new AppError('FOLDER_ALREADY_EXISTS', 'A folder with that name already exists.', 409);
      }

      const sourceKeys = await this.listObjectKeys(currentPrefix);
      if (sourceKeys.length === 0) {
        throw new AppError('FOLDER_NOT_FOUND', 'The requested folder was not found.', 404);
      }

      for (const key of sourceKeys) {
        const destinationKey = `${nextPrefix}${key.slice(currentPrefix.length)}`;
        const encodedSource = key.split('/').map(encodeURIComponent).join('/');
        await this.client.send(new CopyObjectCommand({
          Bucket: this.bucketName,
          CopySource: `${this.bucketName}/${encodedSource}`,
          Key: destinationKey,
          MetadataDirective: 'COPY',
        }));
      }

      for (let index = 0; index < sourceKeys.length; index += 1000) {
        const response = await this.client.send(new DeleteObjectsCommand({
          Bucket: this.bucketName,
          Delete: { Objects: sourceKeys.slice(index, index + 1000).map((Key) => ({ Key })), Quiet: true },
        }));
        if (response.Errors?.length) {
          throw new Error('One or more source objects could not be removed after the folder rename.');
        }
      }

      return { folderName: next };
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.handleS3Error(error, 'S3_ERROR', 'Unable to rename the folder in S3.');
    }
  }

  async deleteFolder(folderName: string): Promise<{ folderName: string }> {
    const folder = normalizeFolderName(folderName);
    const prefix = `${folder}/`;

    try {
      const keys = await this.listObjectKeys(prefix);
      if (keys.length === 0) {
        throw new AppError('FOLDER_NOT_FOUND', 'The requested folder was not found.', 404);
      }

      for (let index = 0; index < keys.length; index += 1000) {
        const response = await this.client.send(new DeleteObjectsCommand({
          Bucket: this.bucketName,
          Delete: { Objects: keys.slice(index, index + 1000).map((Key) => ({ Key })), Quiet: true },
        }));
        if (response.Errors?.length) {
          throw new Error('One or more folder objects could not be deleted.');
        }
      }

      return { folderName: folder };
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.handleS3Error(error, 'S3_ERROR', 'Unable to delete the folder from S3.');
    }
  }

  async listFolders(): Promise<Array<{ folderName: string }>> {
    try {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName,
          Delimiter: '/',
        }),
      );

      const folders = (response.CommonPrefixes ?? [])
        .map((item) => item.Prefix)
        .filter((prefix): prefix is string => typeof prefix === 'string' && prefix.length > 0)
        .map((prefix) => prefix.replace(/\/$/, ''))
        .filter((prefix) => prefix.length > 0)
        .map((prefix) => ({ folderName: prefix }));

      return folders;
    } catch (error) {
      this.handleS3Error(error, 'S3_ERROR', 'Unable to list folders in S3.');
    }
  }

  async listFolderContents(folderName: string): Promise<Array<S3FileSummary>> {
    const folder = normalizeFolderName(folderName);
    const prefix = `${folder}/`;

    try {
      const response = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucketName, Prefix: prefix }));
      return (response.Contents ?? [])
        .map((item) => this.toFileSummary(item))
        .filter((item): item is S3FileSummary => item !== null && item.key.startsWith(prefix) && !item.key.endsWith('/'))
        .filter((item) => item.key.slice(prefix.length).indexOf('/') === -1);
    } catch (error) {
      this.handleS3Error(error, 'S3_ERROR', 'Unable to list the folder contents in S3.');
    }
  }

  async listFiles(folderName?: string, limit = 1000, continuationToken?: string): Promise<{ files: S3FileSummary[]; continuationToken?: string }> {
    const prefix = folderName ? `${normalizeFolderName(folderName)}/` : '';

    try {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: prefix,
          MaxKeys: limit,
          ContinuationToken: continuationToken || undefined,
        }),
      );

      const files = (response.Contents ?? [])
        .map((item) => this.toFileSummary(item))
        .filter((item): item is S3FileSummary => item !== null && !item.key.endsWith('/'))
        .filter((item) => (!folderName ? true : item.key.slice(prefix.length).indexOf('/') === -1));

      return {
        files,
        continuationToken: response.NextContinuationToken || undefined,
      };
    } catch (error) {
      this.handleS3Error(error, 'S3_ERROR', 'Unable to list S3 files.');
    }
  }

  async getFileMetadata(key: string): Promise<S3FileSummary> {
    try {
      const response = await this.client.send(new HeadObjectCommand({ Bucket: this.bucketName, Key: key }));
      if (!response.ContentLength || response.ContentLength < 0) {
        throw new AppError('FILE_NOT_FOUND', 'The requested file was not found.', 404);
      }

      return {
        key,
        fileName: key.split('/').pop() ?? key,
        size: response.ContentLength,
        contentType: response.ContentType ?? 'application/octet-stream',
        lastModified: response.LastModified ? response.LastModified.toISOString() : new Date().toISOString(),
      };
    } catch (error) {
      this.handleS3Error(error, 'S3_ERROR', 'Unable to fetch file metadata.');
    }
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucketName, Key: key }));
      return true;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (status === 404) {
        return false;
      }
      this.handleS3Error(error, 'S3_ERROR', 'Unable to verify file existence.');
    }
  }

  async generateUploadUrl(key: string, contentType: string, expiresIn = this.expirationSeconds): Promise<{ key: string; uploadUrl: string; expiresIn: number }> {
    try {
      const command = new PutObjectCommand({ Bucket: this.bucketName, Key: key, ContentType: contentType });
      const uploadUrl = await getSignedUrl(this.client, command, { expiresIn });
      return { key, uploadUrl, expiresIn };
    } catch (error) {
      this.handleS3Error(error, 'S3_ERROR', 'Unable to generate a presigned upload URL.');
    }
  }

  async generateDownloadUrl(key: string, expiresIn = this.expirationSeconds): Promise<{ key: string; downloadUrl: string; expiresIn: number }> {
    try {
      const command = new GetObjectCommand({ Bucket: this.bucketName, Key: key });
      const downloadUrl = await getSignedUrl(this.client, command, { expiresIn });
      return { key, downloadUrl, expiresIn };
    } catch (error) {
      this.handleS3Error(error, 'S3_ERROR', 'Unable to generate a presigned download URL.');
    }
  }

  async replaceFile(currentKey: string, nextKey: string, contentType: string): Promise<{ key: string; uploadUrl: string; expiresIn: number }> {
    if (currentKey === nextKey) {
      return this.generateUploadUrl(nextKey, contentType, this.expirationSeconds);
    }

    try {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.bucketName,
          CopySource: `${this.bucketName}/${encodeURIComponent(currentKey)}`,
          Key: nextKey,
          MetadataDirective: 'REPLACE',
          ContentType: contentType,
        }),
      );

      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: currentKey }));
      return this.generateUploadUrl(nextKey, contentType, this.expirationSeconds);
    } catch (error) {
      this.handleS3Error(error, 'S3_ERROR', 'Unable to replace the file in S3.');
    }
  }

  async deleteFile(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: key }));
    } catch (error) {
      this.handleS3Error(error, 'S3_ERROR', 'Unable to delete the file in S3.');
    }
  }
}
