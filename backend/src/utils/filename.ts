export const ALLOWED_CONTENT_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
  'application/rtf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'application/zip',
]);

function hasControlChars(value: string): boolean {
  return [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
}

export function normalizeFolderName(folderName: string): string {
  const value = String(folderName ?? '').trim().replace(/\\/g, '/');

  if (!value) {
    throw new Error('INVALID_FOLDER_NAME');
  }

  if (value.startsWith('/') || value.includes('../') || value.includes('/..') || value === '..' || value === '.') {
    throw new Error('INVALID_FOLDER_NAME');
  }

  const normalized = value.replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');

  if (!normalized || normalized === '.' || normalized === '..') {
    throw new Error('INVALID_FOLDER_NAME');
  }

  if (hasControlChars(normalized)) {
    throw new Error('INVALID_FOLDER_NAME');
  }

  const segments = normalized.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..' || !/^[A-Za-z0-9._-]+$/.test(segment))) {
    throw new Error('INVALID_FOLDER_NAME');
  }

  return segments.join('/');
}

export function normalizeFileName(fileName: string): string {
  const value = String(fileName ?? '').trim();

  if (!value) {
    throw new Error('INVALID_FILE_NAME');
  }

  if (value.includes('/') || value.includes('\\') || value.includes('../') || value.includes('..')) {
    throw new Error('INVALID_FILE_NAME');
  }

  if (hasControlChars(value)) {
    throw new Error('INVALID_FILE_NAME');
  }

  const normalized = value.replace(/\s+/g, ' ').trim();

  if (!/^[A-Za-z0-9][A-Za-z0-9._ -]*\.[A-Za-z0-9]+$/.test(normalized) && !/^[A-Za-z0-9][A-Za-z0-9._ -]+$/.test(normalized)) {
    throw new Error('INVALID_FILE_NAME');
  }

  return normalized;
}

export function validateContentType(contentType: string): boolean {
  return ALLOWED_CONTENT_TYPES.has(contentType.trim().toLowerCase());
}

export function safeS3Key(folderName: string, fileName: string): string {
  const folder = normalizeFolderName(folderName);
  const file = normalizeFileName(fileName);
  return `${folder}/${file}`;
}

export function isValidS3Key(key: string): boolean {
  if (!key || key.startsWith('/') || key.includes('..') || key.includes('\\')) {
    return false;
  }

  const trimmed = key.trim();
  return trimmed.length > 0 && !hasControlChars(trimmed);
}
