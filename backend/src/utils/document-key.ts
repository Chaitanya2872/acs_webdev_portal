import crypto from 'node:crypto';

// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;
const MAX_FILENAME_LENGTH = 200;

/**
 * Cleans a user-supplied filename for storage as metadata (never as a path):
 * strips directories, control and reserved characters, collapses whitespace, keeps Unicode letters.
 */
export function sanitizeDisplayFilename(fileName: string, requiredExtension = '.pdf'): string {
  const base = String(fileName ?? '')
    .normalize('NFC')
    .split(/[\\/]/)
    .pop()!
    .replace(CONTROL_CHARS, '')
    .replace(/[<>:"|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const hasExtension = base.toLowerCase().endsWith(requiredExtension);
  const stem = (hasExtension ? base.slice(0, -requiredExtension.length) : base).replace(/^[.\s]+/, '').trim();
  if (!stem) {
    throw new Error('INVALID_FILE_NAME');
  }

  return `${stem.slice(0, MAX_FILENAME_LENGTH - requiredExtension.length)}${requiredExtension}`;
}

/** ASCII-only, URL-safe slug for the final segment of an S3 key. Non-Latin names fall back to "document". */
export function slugifyFilename(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[A-Za-z0-9]{1,5}$/, '');
  const slug = withoutExtension
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return slug || 'document';
}

const SAFE_PREFIX_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/;

export function normalizeKeyPrefix(prefix: string): string {
  const segments = String(prefix ?? '').split('/').filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => !SAFE_PREFIX_SEGMENT.test(segment))) {
    throw new Error(`Invalid S3 key prefix: ${prefix}`);
  }
  return segments.join('/');
}

/**
 * Final, immutable object key for one version of a document:
 *   <documentsPrefix>/<categoryPrefix>/<period>/<documentId>/v<version>-<slug>.<ext>
 * The document id makes keys collision-free; the version segment means a replacement never overwrites an object,
 * so CDN and browser caches can never serve a stale file under a new URL.
 */
export function buildDocumentObjectKey(input: {
  documentsPrefix: string;
  categoryPrefix: string;
  financialYear?: string | null;
  documentDate?: string | null;
  documentId: string;
  version: number;
  fileName: string;
  extension?: string;
}): string {
  const period = input.financialYear ?? (input.documentDate ? input.documentDate.slice(0, 4) : 'undated');
  if (!/^(\d{4}(-\d{2})?|undated)$/.test(period)) {
    throw new Error('Invalid period for object key');
  }
  if (!/^[0-9a-f-]{36}$/.test(input.documentId) || !Number.isInteger(input.version) || input.version < 1) {
    throw new Error('Invalid document id or version for object key');
  }
  const extension = (input.extension ?? 'pdf').replace(/^\./, '').toLowerCase();
  return [
    normalizeKeyPrefix(input.documentsPrefix),
    normalizeKeyPrefix(input.categoryPrefix),
    period,
    input.documentId,
    `v${input.version}-${slugifyFilename(input.fileName)}.${extension}`,
  ].join('/');
}

export function buildStagingKey(documentsPrefix: string, uploadId: string): string {
  return `${normalizeKeyPrefix(documentsPrefix)}/_incoming/${uploadId}.pdf`;
}

/** True when a key or folder path is inside the managed documents prefix (reserved for this module). */
export function isWithinPrefix(keyOrFolder: string, documentsPrefix: string): boolean {
  const prefix = normalizeKeyPrefix(documentsPrefix);
  const value = String(keyOrFolder ?? '').replace(/^\/+/, '');
  return value === prefix || value.startsWith(`${prefix}/`);
}

/** Indian financial year (April–March) for a YYYY-MM-DD date, formatted 2025-26. */
export function financialYearForDate(isoDate: string): string {
  const [year, month] = isoDate.split('-').map(Number);
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function isValidFinancialYear(value: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  return Boolean(match) && (Number(match![1]) + 1) % 100 === Number(match![2]);
}

/** Deterministic RFC 4122 v5 UUID, used to give migrated legacy documents stable ids across re-runs. */
export function uuidV5(name: string, namespace: string): string {
  const namespaceBytes = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = crypto.createHash('sha1').update(Buffer.concat([namespaceBytes, Buffer.from(name, 'utf8')])).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
