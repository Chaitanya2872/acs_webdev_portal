import { S3Service } from '../../services/s3.service';
import { env } from '../../config/env';
import { buildS3Key } from '../../utils/s3-key';
import { normalizeFileName, normalizeFolderName, validateContentType } from '../../utils/filename';
import { AppError } from '../../utils/response';

export class FileService {
  constructor(private readonly s3Service: S3Service) {}

  async createUploadRequest(body: { folderName: string; fileName: string; contentType: string; fileSize: number }) {
    try {
      const folderName = normalizeFolderName(body.folderName);
      const fileName = normalizeFileName(body.fileName);
      const contentType = String(body.contentType ?? '').trim().toLowerCase();

      if (!validateContentType(contentType)) {
        throw new AppError('UNSUPPORTED_FILE_TYPE', 'The submitted file type is not supported.', 415);
      }

      if (body.fileSize > env.MAX_FILE_SIZE) {
        throw new AppError('FILE_TOO_LARGE', 'The file exceeds the configured maximum size.', 413);
      }

      const key = buildS3Key(folderName, fileName);
      const exists = await this.s3Service.objectExists(key);

      if (exists) {
        throw new AppError('FILE_ALREADY_EXISTS', 'A file with this name already exists in the folder.', 409);
      }

      const upload = await this.s3Service.generateUploadUrl(key, contentType, env.PRESIGNED_URL_EXPIRATION);
      return {
        key,
        fileName,
        uploadUrl: upload.uploadUrl,
        expiresIn: upload.expiresIn,
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      if (error instanceof Error && error.message === 'INVALID_FOLDER_NAME') {
        throw new AppError('INVALID_FOLDER_NAME', 'Invalid folder name.', 400);
      }
      if (error instanceof Error && error.message === 'INVALID_FILE_NAME') {
        throw new AppError('INVALID_FILE_NAME', 'Invalid file name.', 400);
      }
      throw new AppError('INVALID_REQUEST', 'Invalid file upload request.', 400);
    }
  }

  async listFiles(query: { folderName?: string; limit?: number; continuationToken?: string }) {
    try {
      const folderName = query.folderName ? normalizeFolderName(query.folderName) : undefined;
      const limit = query.limit ?? 100;
      return this.s3Service.listFiles(folderName, limit, query.continuationToken);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('INVALID_REQUEST', 'Invalid file listing request.', 400);
    }
  }

  async getFile(key: string) {
    try {
      const trimmedKey = key.trim();
      if (!trimmedKey || trimmedKey.includes('..') || trimmedKey.startsWith('/')) {
        throw new AppError('INVALID_REQUEST', 'The file key is invalid.', 400);
      }

      const metadata = await this.s3Service.getFileMetadata(trimmedKey);
      const download = await this.s3Service.generateDownloadUrl(trimmedKey, env.PRESIGNED_URL_EXPIRATION);

      return {
        ...metadata,
        downloadUrl: download.downloadUrl,
        expiresIn: download.expiresIn,
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('INVALID_REQUEST', 'Invalid file request.', 400);
    }
  }

  async replaceFile(key: string, body: { fileName?: string; contentType?: string; fileSize?: number }) {
    try {
      const safeKey = key.trim();
      if (!safeKey || safeKey.includes('..') || safeKey.startsWith('/')) {
        throw new AppError('INVALID_REQUEST', 'The file key is invalid.', 400);
      }

      const currentMeta = await this.s3Service.getFileMetadata(safeKey);
      const contentType = String(body.contentType ?? currentMeta.contentType ?? '').trim().toLowerCase();

      if (!validateContentType(contentType)) {
        throw new AppError('UNSUPPORTED_FILE_TYPE', 'The submitted file type is not supported.', 415);
      }

      const fileSize = body.fileSize ?? currentMeta.size;
      if (fileSize > env.MAX_FILE_SIZE) {
        throw new AppError('FILE_TOO_LARGE', 'The file exceeds the configured maximum size.', 413);
      }

      const folderName = safeKey.split('/').slice(0, -1).join('/') || '';
      const currentFileName = safeKey.split('/').pop() ?? safeKey;
      const targetFileName = body.fileName ? normalizeFileName(body.fileName) : currentFileName;
      const targetKey = folderName ? buildS3Key(folderName, targetFileName) : targetFileName;

      if (targetKey !== safeKey && (await this.s3Service.objectExists(targetKey))) {
        throw new AppError('FILE_ALREADY_EXISTS', 'A different file with this name already exists in the folder.', 409);
      }

      const result = await this.s3Service.replaceFile(safeKey, targetKey, contentType);
      return {
        key: targetKey,
        fileName: targetFileName,
        uploadUrl: result.uploadUrl,
        expiresIn: result.expiresIn,
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('INVALID_REQUEST', 'Invalid file replacement request.', 400);
    }
  }

  async deleteFile(key: string) {
    try {
      const safeKey = key.trim();
      if (!safeKey || safeKey.includes('..') || safeKey.startsWith('/')) {
        throw new AppError('INVALID_REQUEST', 'The file key is invalid.', 400);
      }

      const exists = await this.s3Service.objectExists(safeKey);
      if (!exists) {
        throw new AppError('FILE_NOT_FOUND', 'The requested file was not found.', 404);
      }

      await this.s3Service.deleteFile(safeKey);
      return { success: true, message: 'File deleted successfully' };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('INVALID_REQUEST', 'Invalid file deletion request.', 400);
    }
  }
}
