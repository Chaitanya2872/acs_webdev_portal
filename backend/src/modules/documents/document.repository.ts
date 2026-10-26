import { Database, Queryable } from '../../db/database';

export type DocumentStatus = 'draft' | 'published' | 'unpublished' | 'archived';

export type CategoryRow = {
  id: number;
  parent_id: number | null;
  slug: string;
  name: string;
  s3_prefix: string;
  website_path: string | null;
  legacy_folder: string | null;
  legacy_page: string | null;
  group_by_financial_year: boolean;
  sort_order: number;
  is_active: boolean;
};

export type CategoryNode = {
  id: number;
  parentId: number | null;
  slug: string;
  name: string;
  path: string;
  s3Prefix: string;
  websitePath: string | null;
  legacyFolder: string | null;
  groupByFinancialYear: boolean;
  isLeaf: boolean;
  isActive: boolean;
  children: CategoryNode[];
};

type DocumentRow = {
  id: string;
  title: string;
  original_filename: string;
  display_filename: string;
  category_id: number;
  financial_year: string | null;
  reporting_period: string | null;
  document_date: string | null;
  status: DocumentStatus;
  current_version_id: string | null;
  legacy_path: string | null;
  uploaded_by: number | null;
  uploaded_by_name: string | null;
  updated_by_name: string | null;
  created_at: Date;
  updated_at: Date;
  published_at: Date | null;
  archived_at: Date | null;
  version: number | null;
  s3_object_key: string | null;
  version_original_filename: string | null;
  file_size: string | number | null;
  content_type: string | null;
  etag: string | null;
  version_created_at: Date | null;
  version_count: number;
  total?: number;
};

export type VersionRow = {
  id: string;
  document_id: string;
  version: number;
  s3_object_key: string;
  original_filename: string;
  file_size: string | number;
  content_type: string;
  etag: string | null;
  sha256: string | null;
  uploaded_by: number | null;
  uploaded_by_name: string | null;
  created_at: Date;
};

export type PlacementRow = {
  document_id: string;
  category_id: number;
  display_order: number;
  title_override: string | null;
  slug: string;
  name: string;
};

const iso = (value: Date | string | null | undefined) => (value ? new Date(value).toISOString() : null);

export const DOCUMENT_SELECT = `
  SELECT d.id, d.title, d.original_filename, d.display_filename, d.category_id, d.financial_year, d.reporting_period,
         to_char(d.document_date, 'YYYY-MM-DD') AS document_date, d.status, d.current_version_id, d.legacy_path,
         d.uploaded_by, uploader.name AS uploaded_by_name, editor.name AS updated_by_name,
         d.created_at, d.updated_at, d.published_at, d.archived_at,
         v.version, v.s3_object_key, v.original_filename AS version_original_filename, v.file_size, v.content_type, v.etag,
         v.created_at AS version_created_at,
         (SELECT count(*)::int FROM document_versions dv WHERE dv.document_id = d.id) AS version_count
  FROM documents d
  LEFT JOIN document_versions v ON v.id = d.current_version_id
  LEFT JOIN admin_users uploader ON uploader.id = d.uploaded_by
  LEFT JOIN admin_users editor ON editor.id = d.updated_by`;

export function mapVersion(row: VersionRow) {
  return {
    id: row.id,
    version: row.version,
    s3ObjectKey: row.s3_object_key,
    originalFilename: row.original_filename,
    fileSize: Number(row.file_size),
    contentType: row.content_type,
    etag: row.etag,
    uploadedBy: row.uploaded_by_name,
    createdAt: iso(row.created_at),
  };
}

export function mapDocument(row: DocumentRow, placements: PlacementRow[], categoryPaths: Map<number, string>) {
  const own = placements.filter((placement) => placement.document_id === row.id);
  const primary = own.find((placement) => placement.category_id === row.category_id);
  return {
    id: row.id,
    title: row.title,
    originalFilename: row.original_filename,
    displayFilename: row.display_filename,
    categoryId: row.category_id,
    categoryPath: categoryPaths.get(row.category_id) ?? null,
    displayOrder: primary?.display_order ?? 0,
    placements: own.map((placement) => ({
      categoryId: placement.category_id,
      slug: placement.slug,
      name: placement.name,
      path: categoryPaths.get(placement.category_id) ?? placement.name,
      displayOrder: placement.display_order,
      titleOverride: placement.title_override,
      isPrimary: placement.category_id === row.category_id,
    })),
    financialYear: row.financial_year,
    reportingPeriod: row.reporting_period,
    documentDate: row.document_date,
    status: row.status,
    legacyPath: row.legacy_path,
    currentVersion: row.current_version_id
      ? {
          id: row.current_version_id,
          version: row.version,
          s3ObjectKey: row.s3_object_key,
          originalFilename: row.version_original_filename,
          fileSize: Number(row.file_size ?? 0),
          contentType: row.content_type,
          etag: row.etag,
          createdAt: iso(row.version_created_at),
        }
      : null,
    versionCount: row.version_count,
    uploadedBy: row.uploaded_by_name,
    updatedBy: row.updated_by_name,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    publishedAt: iso(row.published_at),
    archivedAt: iso(row.archived_at),
  };
}

export type AdminDocument = ReturnType<typeof mapDocument>;

export class DocumentRepository {
  constructor(private readonly db: Database) {}

  async listCategories(): Promise<CategoryRow[]> {
    return (await this.db.query<CategoryRow>('SELECT * FROM document_categories ORDER BY sort_order, name')).rows;
  }

  async findDocumentRows(where: string, params: unknown[], suffix = '', executor: Queryable = this.db) {
    return (await executor.query<DocumentRow>(`${DOCUMENT_SELECT} ${where} ${suffix}`, params)).rows;
  }

  async findPlacements(documentIds: string[], executor: Queryable = this.db): Promise<PlacementRow[]> {
    if (documentIds.length === 0) return [];
    return (
      await executor.query<PlacementRow>(
        `SELECT p.document_id, p.category_id, p.display_order, p.title_override, c.slug, c.name
         FROM document_placements p JOIN document_categories c ON c.id = p.category_id
         WHERE p.document_id = ANY($1::uuid[]) ORDER BY c.sort_order, c.name`,
        [documentIds],
      )
    ).rows;
  }

  async findVersions(documentId: string, executor: Queryable = this.db): Promise<VersionRow[]> {
    return (
      await executor.query<VersionRow>(
        `SELECT v.*, u.name AS uploaded_by_name FROM document_versions v
         LEFT JOIN admin_users u ON u.id = v.uploaded_by
         WHERE v.document_id = $1 ORDER BY v.version DESC`,
        [documentId],
      )
    ).rows;
  }
}
