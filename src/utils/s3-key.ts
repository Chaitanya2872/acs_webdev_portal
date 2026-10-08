import { normalizeFileName, normalizeFolderName } from './filename';

export function buildS3Key(folderName: string, fileName: string): string {
  const folder = normalizeFolderName(folderName);
  const file = normalizeFileName(fileName);
  return `${folder}/${file}`;
}

export function toFolderMarker(folderName: string): string {
  return `${normalizeFolderName(folderName)}/`;
}
