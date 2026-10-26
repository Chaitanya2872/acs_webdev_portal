import { env } from '../../config/env';
import { Database } from '../../db/database';
import { S3Service } from '../../services/s3.service';
import { AppError } from '../../utils/response';
import { CategoryRow } from './document.repository';
import { parseInput, publicListSchema } from './document.schema';

type PublicRow = {
  id: string;
  title: string;
  display_filename: string;
  financial_year: string | null;
  reporting_period: string | null;
  document_date: string | null;
  published_at: Date | null;
  updated_at: Date;
  version: number;
  content_type: string;
  file_size: string | number;
  s3_object_key: string;
  total: number;
};

const LEGACY_PREFIX = '/assets/docs/';
const notPublished = () => new AppError('DOCUMENT_NOT_FOUND', 'The requested document is not available.', 404);

const encodeKey = (key: string) => key.split('/').map(encodeURIComponent).join('/');

/** Read-only queries for the corporate website. Only published documents with a stored file are ever exposed. */
export class PublicDocumentService {
  constructor(
    private readonly db: Database,
    private readonly storage: S3Service,
  ) {}

  /** URL website visitors use to open a document: the CDN object when configured, otherwise the redirecting API endpoint. */
  fileUrl(baseUrl: string, document: { id: string; s3_object_key: string; version: number }): string {
    if (env.PUBLIC_CDN_BASE_URL) {
      return `${env.PUBLIC_CDN_BASE_URL.replace(/\/+$/, '')}/${encodeKey(document.s3_object_key)}`;
    }
    return `${baseUrl}/api/v1/public/documents/${document.id}/file?v=${document.version}`;
  }

  async listSections() {
    const rows = (await this.db.query<CategoryRow & { document_count: number }>(
      `SELECT c.*, (
         SELECT count(*)::int FROM document_placements p JOIN documents d ON d.id = p.document_id
         WHERE p.category_id = c.id AND d.status = 'published'
       ) AS document_count
       FROM document_categories c
       WHERE c.is_active AND NOT EXISTS (SELECT 1 FROM document_categories child WHERE child.parent_id = c.id)
       ORDER BY c.sort_order, c.name`,
    )).rows;
    return rows.map((row) => ({
      slug: row.slug,
      title: row.name,
      websitePath: row.website_path,
      groupByFinancialYear: row.group_by_financial_year,
      documentCount: row.document_count,
    }));
  }

  async listSectionDocuments(slug: string, query: unknown, baseUrl: string) {
    const filter = parseInput(publicListSchema, query);
    const section = (await this.db.query<CategoryRow>(
      `SELECT * FROM document_categories c WHERE c.slug = $1 AND c.is_active
       AND NOT EXISTS (SELECT 1 FROM document_categories child WHERE child.parent_id = c.id)`,
      [slug],
    )).rows[0];
    if (!section) throw new AppError('SECTION_NOT_FOUND', 'The requested document section does not exist.', 404);

    const params: unknown[] = [section.id];
    let yearFilter = '';
    if (filter.financialYear) {
      params.push(filter.financialYear);
      yearFilter = `AND d.financial_year = $${params.length}`;
    }
    params.push(filter.pageSize, (filter.page - 1) * filter.pageSize);

    const rows = (await this.db.query<PublicRow>(
      `SELECT d.id, coalesce(p.title_override, d.title) AS title, d.display_filename, d.financial_year, d.reporting_period,
              to_char(d.document_date, 'YYYY-MM-DD') AS document_date, d.published_at, d.updated_at,
              v.version, v.content_type, v.file_size, v.s3_object_key, count(*) OVER ()::int AS total
       FROM document_placements p
       JOIN documents d ON d.id = p.document_id
       JOIN document_versions v ON v.id = d.current_version_id
       WHERE p.category_id = $1 AND d.status = 'published' ${yearFilter}
       ORDER BY p.display_order ASC, d.document_date DESC NULLS LAST, d.published_at DESC NULLS LAST, d.created_at DESC, d.id
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    )).rows;

    const total = rows[0]?.total ?? 0;
    return {
      section: { slug: section.slug, title: section.name, websitePath: section.website_path, groupByFinancialYear: section.group_by_financial_year },
      documents: rows.map((row) => ({
        id: row.id,
        title: row.title,
        type: row.content_type === 'application/pdf' ? 'pdf' : row.content_type === 'text/html' ? 'html' : 'file',
        url: this.fileUrl(baseUrl, row),
        downloadUrl: env.PUBLIC_CDN_BASE_URL ? this.fileUrl(baseUrl, row) : `${baseUrl}/api/v1/public/documents/${row.id}/file?v=${row.version}&download=1`,
        fileName: row.display_filename,
        fileSize: Number(row.file_size),
        financialYear: row.financial_year,
        reportingPeriod: row.reporting_period,
        documentDate: row.document_date,
        publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
        updatedAt: new Date(row.updated_at).toISOString(),
        version: row.version,
      })),
      pagination: { page: filter.page, pageSize: filter.pageSize, total, totalPages: Math.max(1, Math.ceil(total / filter.pageSize)) },
    };
  }

  /** Presigned, short-lived S3 URL for the current version of a published document. */
  async resolveFileUrl(documentId: string, download: boolean): Promise<string> {
    if (!/^[0-9a-f-]{36}$/i.test(documentId)) throw notPublished();
    const row = (await this.db.query<{ display_filename: string; s3_object_key: string; content_type: string }>(
      `SELECT d.display_filename, v.s3_object_key, v.content_type
       FROM documents d JOIN document_versions v ON v.id = d.current_version_id
       WHERE d.id = $1 AND d.status = 'published'`,
      [documentId],
    )).rows[0];
    if (!row) throw notPublished();

    const { downloadUrl } = await this.storage.generateDownloadUrl(row.s3_object_key, env.PUBLIC_DOCUMENT_URL_TTL, {
      fileName: row.display_filename,
      disposition: download ? 'attachment' : 'inline',
      contentType: row.content_type,
    });
    return downloadUrl;
  }

  /** Maps an old website URL (/assets/docs/<folder>/<file>) to the published document migrated from it. */
  async resolveLegacyPath(rawPath: string, baseUrl: string) {
    const legacyPath = normalizeLegacyPath(rawPath);
    if (!legacyPath) throw new AppError('INVALID_REQUEST', 'A legacy /assets/docs/ path is required.', 400);

    const row = (await this.db.query<{ id: string; title: string; s3_object_key: string; version: number }>(
      `SELECT d.id, d.title, v.s3_object_key, v.version
       FROM documents d JOIN document_versions v ON v.id = d.current_version_id
       WHERE d.status = 'published' AND (d.legacy_path = $1 OR lower(d.legacy_path) = lower($1))
       ORDER BY (d.legacy_path = $1) DESC LIMIT 1`,
      [legacyPath],
    )).rows[0];
    if (!row) throw notPublished();
    return { id: row.id, title: row.title, url: this.fileUrl(baseUrl, row) };
  }
}

/** Decodes and validates a legacy document path; returns null when it is not under /assets/docs/. */
export function normalizeLegacyPath(rawPath: string): string | null {
  let value = String(rawPath ?? '').trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    return null;
  }
  value = value.replace(/\\/g, '/').replace(/^(?:https?:\/\/[^/]+)?\/?/, '/');
  if (!value.startsWith(LEGACY_PREFIX) || value.includes('/../') || value.includes('\0') || value.length > 500) {
    return null;
  }
  return value;
}
