import { S3Service } from '../../services/s3.service';
import { normalizeFolderName } from '../../utils/filename';
import { AppError } from '../../utils/response';

export class FolderService {
  constructor(private readonly s3Service: S3Service) {}

  async createFolder(folderName: string): Promise<{ folderName: string }> {
    try {
      const folder = normalizeFolderName(folderName);
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
    return this.s3Service.listFolders();
  }

  async renameFolder(currentFolderName: string, newName: string): Promise<{ folderName: string }> {
    const current = normalizeFolderName(currentFolderName);
    const normalizedName = normalizeFolderName(newName);
    if (normalizedName.includes('/')) {
      throw new AppError('INVALID_FOLDER_NAME', 'Enter a folder name without a path.', 400);
    }
    const parent = current.split('/').slice(0, -1).join('/');
    const next = parent ? `${parent}/${normalizedName}` : normalizedName;
    return this.s3Service.renameFolder(current, next);
  }

  async deleteFolder(folderName: string): Promise<{ folderName: string }> {
    return this.s3Service.deleteFolder(normalizeFolderName(folderName));
  }

  async getFolderContents(folderName: string): Promise<{ folderName: string; folders: Array<{ folderName: string }>; files: Array<{ key: string; fileName: string; size: number; contentType: string; lastModified: string }> }> {
    const folder = normalizeFolderName(folderName);
    const [folders, files] = await Promise.all([
      this.s3Service.listSubfolders(folder),
      this.s3Service.listFolderContents(folder),
    ]);
    return { folderName: folder, folders, files };
  }
}
