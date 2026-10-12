import { S3Service, S3FileSummary } from './s3.service';
import { env } from '../config/env';
import { normalizeFolderName } from '../utils/filename';
import { toFolderMarker } from '../utils/s3-key';
import { AppError } from '../utils/response';

type MemoryFile = S3FileSummary & { body: Buffer };

export class MemoryStorageService extends S3Service {
  private readonly objects = new Map<string, MemoryFile>();

  async ensureFolder(folderName: string): Promise<{ folderName: string }> {
    const normalized = normalizeFolderName(folderName);
    const key = toFolderMarker(normalized);
    if (!this.objects.has(key)) {
      this.objects.set(key, {
        key,
        fileName: '',
        size: 0,
        contentType: 'application/x-directory',
        lastModified: new Date().toISOString(),
        body: Buffer.alloc(0),
      });
    }
    return { folderName: normalized };
  }

  async listFolders(): Promise<Array<{ folderName: string }>> {
    const folders = new Set<string>();
    for (const key of this.objects.keys()) {
      const firstSlash = key.indexOf('/');
      if (firstSlash > 0) {
        folders.add(key.slice(0, firstSlash));
      }
    }
    return [...folders].sort().map((folderName) => ({ folderName }));
  }

  async listFolderContents(folderName: string): Promise<S3FileSummary[]> {
    const prefix = `${normalizeFolderName(folderName)}/`;
    return [...this.objects.values()]
      .filter((file) => file.key.startsWith(prefix) && !file.key.endsWith('/') && !file.key.slice(prefix.length).includes('/'))
      .map(({ body: _body, ...file }) => file)
      .sort((left, right) => left.key.localeCompare(right.key));
  }

  async listSubfolders(folderName: string): Promise<Array<{ folderName: string }>> {
    const prefix = `${normalizeFolderName(folderName)}/`;
    const folders = new Set<string>();
    for (const key of this.objects.keys()) {
      if (!key.startsWith(prefix)) continue;
      const remaining = key.slice(prefix.length);
      const slash = remaining.indexOf('/');
      if (slash > 0) folders.add(`${prefix}${remaining.slice(0, slash)}`);
    }
    return [...folders].sort().map((folderName) => ({ folderName }));
  }

  async renameFolder(currentFolderName: string, nextFolderName: string): Promise<{ folderName: string }> {
    const current = normalizeFolderName(currentFolderName);
    const next = normalizeFolderName(nextFolderName);
    if (current === next) return { folderName: next };
    if (next.startsWith(`${current}/`)) {
      throw new AppError('INVALID_FOLDER_NAME', 'A folder cannot be moved inside itself.', 400);
    }

    const currentPrefix = `${current}/`;
    const nextPrefix = `${next}/`;
    const sourceEntries = [...this.objects.entries()].filter(([key]) => key.startsWith(currentPrefix));
    if (sourceEntries.length === 0) {
      throw new AppError('FOLDER_NOT_FOUND', 'The requested folder was not found.', 404);
    }
    if ([...this.objects.keys()].some((key) => key.startsWith(nextPrefix))) {
      throw new AppError('FOLDER_ALREADY_EXISTS', 'A folder with that name already exists.', 409);
    }

    for (const [key, value] of sourceEntries) {
      const destinationKey = `${nextPrefix}${key.slice(currentPrefix.length)}`;
      this.objects.set(destinationKey, { ...value, key: destinationKey });
      this.objects.delete(key);
    }
    return { folderName: next };
  }

  async deleteFolder(folderName: string): Promise<{ folderName: string }> {
    const folder = normalizeFolderName(folderName);
    const prefix = `${folder}/`;
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(prefix));
    if (keys.length === 0) {
      throw new AppError('FOLDER_NOT_FOUND', 'The requested folder was not found.', 404);
    }
    keys.forEach((key) => this.objects.delete(key));
    return { folderName: folder };
  }

  async listFiles(folderName?: string, limit = 1000, continuationToken?: string): Promise<{ files: S3FileSummary[]; continuationToken?: string }> {
    const prefix = folderName ? `${normalizeFolderName(folderName)}/` : '';
    const files = [...this.objects.values()]
      .filter((file) => !file.key.endsWith('/') && file.key.startsWith(prefix))
      .filter((file) => !folderName || !file.key.slice(prefix.length).includes('/'))
      .sort((left, right) => left.key.localeCompare(right.key));
    const start = Number(continuationToken ?? 0);
    const page = files.slice(start, start + limit).map(({ body: _body, ...file }) => file);
    const next = start + limit < files.length ? String(start + limit) : undefined;
    return { files: page, continuationToken: next };
  }

  async getFileMetadata(key: string): Promise<S3FileSummary> {
    const file = this.objects.get(key);
    if (!file || key.endsWith('/')) {
      throw new AppError('FILE_NOT_FOUND', 'The requested file was not found.', 404);
    }
    const { body: _body, ...summary } = file;
    return summary;
  }

  async objectExists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async generateUploadUrl(key: string, _contentType: string, expiresIn = env.PRESIGNED_URL_EXPIRATION): Promise<{ key: string; uploadUrl: string; expiresIn: number }> {
    return { key, uploadUrl: this.localUrl(key), expiresIn };
  }

  async generateDownloadUrl(key: string, expiresIn = env.PRESIGNED_URL_EXPIRATION): Promise<{ key: string; downloadUrl: string; expiresIn: number }> {
    return { key, downloadUrl: this.localUrl(key), expiresIn };
  }

  async replaceFile(currentKey: string, nextKey: string, contentType: string): Promise<{ key: string; uploadUrl: string; expiresIn: number }> {
    if (currentKey !== nextKey) {
      const current = this.objects.get(currentKey);
      if (!current) {
        throw new AppError('FILE_NOT_FOUND', 'The requested file was not found.', 404);
      }
      this.objects.set(nextKey, { ...current, key: nextKey, fileName: nextKey.split('/').pop() ?? nextKey, contentType, lastModified: new Date().toISOString() });
      this.objects.delete(currentKey);
    }
    return this.generateUploadUrl(nextKey, contentType);
  }

  async deleteFile(key: string): Promise<void> {
    this.objects.delete(key);
  }

  uploadLocalFile(key: string, body: Buffer, contentType: string): void {
    this.objects.set(key, {
      key,
      fileName: key.split('/').pop() ?? key,
      size: body.length,
      contentType,
      lastModified: new Date().toISOString(),
      body,
    });
  }

  getLocalFile(key: string): { body: Buffer; contentType: string } | undefined {
    const file = this.objects.get(key);
    return file ? { body: file.body, contentType: file.contentType } : undefined;
  }

  private localUrl(key: string): string {
    const path = key.split('/').map(encodeURIComponent).join('/');
    return `http://localhost:${env.PORT}/api/v1/local-storage/${path}`;
  }
}