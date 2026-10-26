import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Database } from '../../db/database';
import { S3Service, buildContentDisposition } from '../../services/s3.service';
import { buildDocumentObjectKey, financialYearForDate, isValidFinancialYear, uuidV5 } from '../../utils/document-key';
import { checkPdfBytes } from '../../utils/pdf';
import { AuditService, systemActor } from '../audit/audit.service';
import { CategoryRow } from './document.repository';
import { normalizeLegacyPath } from './public-document.service';

/** Namespace for deterministic ids of migrated documents (uuidV5(legacyPath)). Never change it. */
export const LEGACY_DOCUMENT_NAMESPACE = '6f1c2f4e-3b0a-4f3e-9a51-8d1f0c6e2b7a';

export type WebsiteDocumentPage = {
  slug: string;
  title: string;
  documents: Array<{ title: string; href: string; type?: string }>;
};

type Placement = { slug: string; title: string; index: number };

type LegacyEntry = {
  legacyPath: string;
  placements: Placement[];
};

export type MigrationReport = {
  startedAt: string;
  finishedAt?: string;
  dryRun: boolean;
  website: { pages: number; references: number; uniqueFiles: number; filesOnDisk: number };
  results: {
    migrated: number;
    alreadyMigrated: number;
    repairedObjects: number;
    uploadedObjects: number;
    reusedObjects: number;
    failed: number;
  };
  unmappedPages: string[];
  failures: Array<{ legacyPath: string; reason: string }>;
  warnings: Array<{ legacyPath: string; warning: string }>;
  sharedReferences: Array<{ legacyPath: string; pages: string[] }>;
  contentDuplicates: Array<{ sha256: string; legacyPaths: string[] }>;
  unreferencedFiles: string[];
  brokenLiveLinks: Array<{ legacyPath: string; status: number | string }>;
  documents: Array<{
    legacyPath: string;
    documentId: string;
    title: string;
    primarySection: string;
    otherSections: string[];
    objectKey: string;
    financialYear: string | null;
    documentDate: string | null;
    status: 'migrated' | 'already-migrated' | 'failed' | 'dry-run';
  }>;
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_PATTERN = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

const toIsoDate = (year: number, month: number, day: number): string | null => {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null;
  return date.toISOString().slice(0, 10);
};

/**
 * Best-effort date from a filing title or filename, e.g. "13th Aug 2026", "Mar 31 2026", "03.07.2026", "26Aug2025".
 * Returns null rather than guessing when the year or day is missing.
 */
export function inferDocumentDate(text: string): string | null {
  const value = text.toLowerCase().replace(/_/g, ' ');
  const dayMonthYear = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th|h)?[\\s.,-]*${MONTH_PATTERN}\\b[\\s.,'-]*(\\d{4})\\b`).exec(value)
    ?? new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?${MONTH_PATTERN}(\\d{4})\\b`).exec(value);
  if (dayMonthYear) {
    return toIsoDate(Number(dayMonthYear[3]), MONTHS[dayMonthYear[2].slice(0, 3)] ?? MONTHS[dayMonthYear[2]], Number(dayMonthYear[1]));
  }
  const monthDayYear = new RegExp(`\\b${MONTH_PATTERN}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`).exec(value);
  if (monthDayYear) {
    return toIsoDate(Number(monthDayYear[3]), MONTHS[monthDayYear[1].slice(0, 3)], Number(monthDayYear[2]));
  }
  const numeric = /\b(\d{1,2})[._/-](\d{1,2})[._/-](\d{4})\b/.exec(value);
  if (numeric) {
    return toIsoDate(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));
  }
  return null;
}

export function inferFinancialYear(text: string, documentDate: string | null): string | null {
  const explicit = /\b(?:fy\s?)?(20\d{2})-(\d{2})\b/i.exec(text);
  if (explicit && isValidFinancialYear(`${explicit[1]}-${explicit[2]}`)) return `${explicit[1]}-${explicit[2]}`;
  return documentDate ? financialYearForDate(documentDate) : null;
}

const contentTypeFor = (legacyPath: string) => {
  const extension = path.extname(legacyPath).toLowerCase();
  if (extension === '.pdf') return { contentType: 'application/pdf', extension: 'pdf' };
  if (extension === '.html' || extension === '.htm') return { contentType: 'text/html', extension: 'html' };
  return null;
};

const walkFiles = (dir: string): string[] =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walkFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)]))
    : [];

export type LegacyMigrationOptions = {
  pages: WebsiteDocumentPage[];
  publicDir: string;
  documentsPrefix: string;
  dryRun?: boolean;
  publish?: boolean;
  checkLive?: (legacyPath: string) => Promise<number | string>;
  log?: (message: string) => void;
};

/**
 * Imports the website's existing filings: one document per unique /assets/docs/ path, placed on every page that
 * listed it (keeping each page's title and order), with its file uploaded once to S3. Re-running is safe:
 * documents have deterministic ids, existing records are skipped and objects already in S3 are reused.
 */
export async function migrateLegacyDocuments(db: Database, storage: S3Service, options: LegacyMigrationOptions): Promise<MigrationReport> {
  const log = options.log ?? (() => undefined);
  const audit = new AuditService(db);
  const actor = systemActor('legacy-migration');
  const categories = (await db.query<CategoryRow>('SELECT * FROM document_categories')).rows;
  const leafBySlug = new Map(categories.filter((row) => !categories.some((child) => child.parent_id === row.id)).map((row) => [row.slug, row]));

  const report: MigrationReport = {
    startedAt: new Date().toISOString(),
    dryRun: Boolean(options.dryRun),
    website: { pages: options.pages.length, references: 0, uniqueFiles: 0, filesOnDisk: 0 },
    results: { migrated: 0, alreadyMigrated: 0, repairedObjects: 0, uploadedObjects: 0, reusedObjects: 0, failed: 0 },
    unmappedPages: [],
    failures: [],
    warnings: [],
    sharedReferences: [],
    contentDuplicates: [],
    unreferencedFiles: [],
    brokenLiveLinks: [],
    documents: [],
  };

  // 1. Collapse page references into unique legacy files.
  const entries = new Map<string, LegacyEntry>();
  for (const page of options.pages) {
    if (!leafBySlug.has(page.slug)) {
      report.unmappedPages.push(page.slug);
      continue;
    }
    page.documents.forEach((doc, index) => {
      report.website.references += 1;
      const legacyPath = normalizeLegacyPath(doc.href);
      if (!legacyPath) {
        report.failures.push({ legacyPath: doc.href, reason: 'Link is not under /assets/docs/' });
        return;
      }
      const entry = entries.get(legacyPath) ?? { legacyPath, placements: [] };
      if (!entry.placements.some((placement) => placement.slug === page.slug)) {
        entry.placements.push({ slug: page.slug, title: doc.title.trim(), index });
      }
      entries.set(legacyPath, entry);
    });
  }
  report.website.uniqueFiles = entries.size;
  report.sharedReferences = [...entries.values()].filter((entry) => entry.placements.length > 1).map((entry) => ({ legacyPath: entry.legacyPath, pages: entry.placements.map((p) => p.slug) }));

  const docsDir = path.join(options.publicDir, 'assets', 'docs');
  const diskFiles = walkFiles(docsDir);
  report.website.filesOnDisk = diskFiles.length;
  const referenced = new Set([...entries.keys()].map((legacyPath) => path.resolve(options.publicDir, `.${legacyPath}`).toLowerCase()));
  report.unreferencedFiles = diskFiles.filter((file) => !referenced.has(path.resolve(file).toLowerCase())).map((file) => `/${path.relative(options.publicDir, file).split(path.sep).join('/')}`).sort();

  const shaGroups = new Map<string, string[]>();

  // 2. Migrate each unique file.
  for (const entry of entries.values()) {
    const folder = entry.legacyPath.split('/').slice(3, -1).join('/');
    const primary = entry.placements.find((placement) => leafBySlug.get(placement.slug)!.legacy_folder === folder) ?? entry.placements[0];
    const category = leafBySlug.get(primary.slug)!;
    const documentId = uuidV5(entry.legacyPath, LEGACY_DOCUMENT_NAMESPACE);
    const fileName = path.basename(entry.legacyPath);
    const documentDate = inferDocumentDate(primary.title) ?? inferDocumentDate(fileName);
    const financialYear = inferFinancialYear(`${primary.title} ${fileName}`, documentDate);
    const record: MigrationReport['documents'][number] = {
      legacyPath: entry.legacyPath,
      documentId,
      title: primary.title,
      primarySection: primary.slug,
      otherSections: entry.placements.filter((p) => p !== primary).map((p) => p.slug),
      objectKey: '',
      financialYear,
      documentDate,
      status: 'failed',
    };
    report.documents.push(record);

    if (options.checkLive) {
      const status = await options.checkLive(entry.legacyPath).catch((error: Error) => error.message);
      if (status !== 200) report.brokenLiveLinks.push({ legacyPath: entry.legacyPath, status });
    }

    const type = contentTypeFor(entry.legacyPath);
    const filePath = path.resolve(options.publicDir, `.${entry.legacyPath}`);
    if (!type) {
      report.failures.push({ legacyPath: entry.legacyPath, reason: 'Unsupported file type' });
      continue;
    }
    if (!filePath.startsWith(path.resolve(options.publicDir)) || !fs.existsSync(filePath)) {
      report.failures.push({ legacyPath: entry.legacyPath, reason: 'File not found in website public/ folder' });
      continue;
    }

    const body = fs.readFileSync(filePath);
    const md5 = crypto.createHash('md5').update(body);
    const md5Hex = md5.copy().digest('hex');
    const md5Base64 = md5.digest('base64');
    const sha256 = crypto.createHash('sha256').update(body).digest('hex');
    shaGroups.set(sha256, [...(shaGroups.get(sha256) ?? []), entry.legacyPath]);

    if (type.contentType === 'application/pdf') {
      const check = checkPdfBytes(body.subarray(0, 1024), body.subarray(Math.max(0, body.length - 2048)));
      if (!check.valid) report.warnings.push({ legacyPath: entry.legacyPath, warning: check.reason });
    }
    if (!documentDate) report.warnings.push({ legacyPath: entry.legacyPath, warning: 'Document date could not be inferred from the title; set it in the portal if needed.' });

    const objectKey = buildDocumentObjectKey({
      documentsPrefix: options.documentsPrefix,
      categoryPrefix: category.s3_prefix,
      financialYear,
      documentDate,
      documentId,
      version: 1,
      fileName,
      extension: type.extension,
    });
    record.objectKey = objectKey;

    const existing = (await db.query<{ id: string; s3_object_key: string | null }>(
      `SELECT d.id, v.s3_object_key FROM documents d LEFT JOIN document_versions v ON v.id = d.current_version_id
       WHERE d.id = $1 OR d.legacy_path = $2 LIMIT 1`,
      [documentId, entry.legacyPath],
    )).rows[0];

    if (options.dryRun) {
      record.status = existing ? 'already-migrated' : 'dry-run';
      if (existing) report.results.alreadyMigrated += 1;
      continue;
    }

    try {
      if (existing) {
        // Already imported: make sure its object is still in S3 (re-upload the original if it went missing).
        record.objectKey = existing.s3_object_key ?? objectKey;
        if (existing.s3_object_key && !(await storage.headObject(existing.s3_object_key))) {
          await storage.putObject(existing.s3_object_key, body, type.contentType, md5Base64, buildContentDisposition('inline', fileName));
          report.results.repairedObjects += 1;
        }
        record.status = 'already-migrated';
        report.results.alreadyMigrated += 1;
        continue;
      }

      const head = await storage.headObject(objectKey);
      let etag = head?.etag ?? '';
      if (head && head.etag === md5Hex && head.size === body.length) {
        report.results.reusedObjects += 1;
      } else {
        etag = (await storage.putObject(objectKey, body, type.contentType, md5Base64, buildContentDisposition('inline', fileName))).etag || md5Hex;
        report.results.uploadedObjects += 1;
      }

      const versionId = uuidV5(`${entry.legacyPath}#v1`, LEGACY_DOCUMENT_NAMESPACE);
      await db.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO documents (id, title, original_filename, display_filename, category_id, financial_year, document_date, status,
                                  current_version_id, legacy_path, published_at)
           VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $7 = 'published' THEN now() END)`,
          [documentId, primary.title, fileName, category.id, financialYear, documentDate, options.publish === false ? 'unpublished' : 'published', versionId, entry.legacyPath],
        );
        await tx.query(
          `INSERT INTO document_versions (id, document_id, version, s3_object_key, original_filename, file_size, content_type, etag, sha256)
           VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8)`,
          [versionId, documentId, objectKey, fileName, body.length, type.contentType, etag, sha256],
        );
        for (const placement of entry.placements) {
          await tx.query(
            `INSERT INTO document_placements (document_id, category_id, display_order, title_override) VALUES ($1, $2, $3, $4)`,
            [documentId, leafBySlug.get(placement.slug)!.id, (placement.index + 1) * 10, placement === primary || placement.title === primary.title ? null : placement.title],
          );
        }
        await audit.record(actor, {
          action: 'document.migrated',
          entityType: 'document',
          entityId: documentId,
          details: { legacyPath: entry.legacyPath, objectKey, sections: entry.placements.map((p) => p.slug), sha256 },
        }, tx);
      });
      record.status = 'migrated';
      report.results.migrated += 1;
      log(`migrated ${entry.legacyPath}`);
    } catch (error) {
      record.status = 'failed';
      report.results.failed += 1;
      report.failures.push({ legacyPath: entry.legacyPath, reason: error instanceof Error ? error.message : String(error) });
      log(`FAILED ${entry.legacyPath}: ${error instanceof Error ? error.message : error}`);
    }
  }

  report.results.failed = report.failures.length;
  report.contentDuplicates = [...shaGroups.entries()].filter(([, paths]) => paths.length > 1).map(([sha256, legacyPaths]) => ({ sha256, legacyPaths }));
  report.finishedAt = new Date().toISOString();
  return report;
}
