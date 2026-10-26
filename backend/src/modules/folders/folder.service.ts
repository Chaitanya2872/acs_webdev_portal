import { S3Service } from '../../services/s3.service';
import { env } from '../../config/env';
import { assertNotReservedPath, normalizeFolderName } from '../../utils/filename';
import { AppError } from '../../utils/response';

export class FolderService {
  constructor(
    private readonly s3Service: S3Service,
    private readonly reservedPrefix: string = env.S3_DOCUMENTS_PREFIX,
  ) {}

  async createFolder(folderName: string): Promise<{ folderName: string }> {
    try {
      const folder = normalizeFolderName(folderName);
      assertNotReservedPath(folder, this.reservedPrefix);
      return await this.s3Service.ensureFolder(folder);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      const message = String(error).includes('INVALID_FOLDER_NAME') ? 'Invalid folder name.' : 'Unable to create the folder.';
      throw new AppError('INVALID_FOLDER_NAME', message, 400);
    }
  }

  async listFolders(): Promise<Array<{ folderName: string }>> {
    const folders = await this.s3Service.listFolders();
    return folders.filter((folder) => folder.folderName !== this.reservedPrefix.split('/')[0]);
  }

  async renameFolder(currentFolderName: string, newName: string): Promise<{ folderName: string }> {
    const current = normalizeFolderName(currentFolderName);
    assertNotReservedPath(current, this.reservedPrefix);
    const normalizedName = normalizeFolderName(newName);
    if (normalizedName.includes('/')) {
      throw new AppError('INVALID_FOLDER_NAME', 'Enter a folder name without a path.', 400);
    }
    const parent = current.split('/').slice(0, -1).join('/');
    const next = parent ? `${parent}/${normalizedName}` : normalizedName;
    assertNotReservedPath(next, this.reservedPrefix);
    return this.s3Service.renameFolder(current, next);
  }

  async deleteFolder(folderName: string): Promise<{ folderName: string }> {
    const folder = normalizeFolderName(folderName);
    assertNotReservedPath(folder, this.reservedPrefix);
    return this.s3Service.deleteFolder(folder);
  }

  async getFolderContents(folderName: string): Promise<{ folderName: string; folders: Array<{ folderName: string }>; files: Array<{ key: string; fileName: string; size: number; contentType: string; lastModified: string }> }> {
    const folder = normalizeFolderName(folderName);
    assertNotReservedPath(folder, this.reservedPrefix);
    const [folders, files] = await Promise.all([
      this.s3Service.listSubfolders(folder),
      this.s3Service.listFolderContents(folder),
    ]);
    return { folderName: folder, folders, files };
  }
}
