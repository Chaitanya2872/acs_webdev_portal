import crypto from 'node:crypto';
import { FastifyBaseLogger } from 'fastify';
import { env } from '../../config/env';
import { Database, Queryable } from '../../db/database';
import { S3Service, buildContentDisposition } from '../../services/s3.service';
import { buildDocumentObjectKey, buildStagingKey, sanitizeDisplayFilename } from '../../utils/document-key';
import { PDF_HEAD_RANGE, PDF_TAIL_RANGE, checkPdfBytes } from '../../utils/pdf';
import { AppError } from '../../utils/response';
import { AuditActor, AuditService } from '../audit/audit.service';
import { Role } from '../auth/auth.service';
import {
  AdminDocument,
  CategoryNode,
  CategoryRow,
  DocumentRepository,
  DocumentStatus,
  mapDocument,
  mapVersion,
} from './document.repository';
import {
  CreateDocumentInput,
  ListDocumentsQuery,
  UpdateDocumentInput,
  createDocumentSchema,
  createUploadSchema,
  listDocumentsSchema,
  parseInput,
  replaceFileSchema,
  updateDocumentSchema,
} from './document.schema';

export const PDF_CONTENT_TYPE = 'application/pdf';

export type DocumentActor = AuditActor & { role: Role };

type UploadRow = {
  id: string;
  staging_key: string;
  original_filename: string;
  declared_size: string | number;
  content_type: string;
  status: 'pending' | 'consumed' | 'rejected';
  created_by: number | null;
  expired: boolean;
};

type StatusAction = 'publish' | 'unpublish' | 'archive' | 'restore';

const STATUS_TRANSITIONS: Record<StatusAction, { from: DocumentStatus[]; to: DocumentStatus; audit: string }> = {
  publish: { from: ['draft', 'unpublished'], to: 'published', audit: 'document.published' },
  unpublish: { from: ['published'], to: 'unpublished', audit: 'document.unpublished' },
  archive: { from: ['draft', 'unpublished', 'published'], to: 'archived', audit: 'document.archived' },
  restore: { from: ['archived'], to: 'unpublished', audit: 'document.restored' },
};

const notFound = () => new AppError('DOCUMENT_NOT_FOUND', 'The requested document was not found.', 404);

export class DocumentService {
  private readonly repository: DocumentRepository;

  constructor(
    private readonly db: Database,
    private readonly storage: S3Service,
    private readonly audit: AuditService,
    private readonly logger: FastifyBaseLogger,
    private readonly documentsPrefix = env.S3_DOCUMENTS_PREFIX,
  ) {
    this.repository = new DocumentRepository(db);
  }

  // ---------------------------------------------------------------- categories

  async listCategoryRows(): Promise<CategoryRow[]> {
    return this.repository.listCategories();
  }

  async getCategoryTree(): Promise<CategoryNode[]> {
    const rows = await this.repository.listCategories();
    const paths = this.categoryPaths(rows);
    const nodes = new Map<number, CategoryNode>(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          parentId: row.parent_id,
          slug: row.slug,
          name: row.name,
          path: paths.get(row.id) ?? row.name,
          s3Prefix: `${this.documentsPrefix}/${row.s3_prefix}/`,
          websitePath: row.website_path,
          legacyFolder: row.legacy_folder,
          groupByFinancialYear: row.group_by_financial_year,
          isLeaf: !rows.some((candidate) => candidate.parent_id === row.id),
          isActive: row.is_active,
          children: [],
        },
      ]),
    );
    const roots: CategoryNode[] = [];
    for (const node of nodes.values()) {
      if (node.parentId && nodes.has(node.parentId)) nodes.get(node.parentId)!.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  private categoryPaths(rows: CategoryRow[]): Map<number, string> {
    const byId = new Map(rows.map((row) => [row.id, row]));
    return new Map(
      rows.map((row) => {
        const parent = row.parent_id ? byId.get(row.parent_id) : undefined;
        return [row.id, parent ? `${parent.name} › ${row.name}` : row.name];
      }),
    );
  }

  /** Documents can only be placed on leaf categories, i.e. actual website document pages. */
  private async requireLeafCategory(categoryId: number, rows?: CategoryRow[]): Promise<CategoryRow> {
    const all = rows ?? (await this.repository.listCategories());
    const category = all.find((row) => row.id === categoryId);
    if (!category || !category.is_active) {
      throw new AppError('INVALID_CATEGORY', 'The selected category does not exist.', 400);
    }
    if (all.some((row) => row.parent_id === category.id)) {
      throw new AppError('INVALID_CATEGORY', `Select a subcategory of "${category.name}".`, 400);
    }
    return category;
  }

  // ---------------------------------------------------------------- uploads

  /** Step 1 of an upload: returns a presigned PUT for a staging key. The browser uploads directly to S3. */
  async createUploadSession(input: unknown, actor: DocumentActor) {
    const data = parseInput(createUploadSchema, input);
    if (data.contentType !== PDF_CONTENT_TYPE || !data.fileName.toLowerCase().endsWith('.pdf')) {
      throw new AppError('UNSUPPORTED_FILE_TYPE', 'Only PDF files can be uploaded.', 415);
    }
    if (data.fileSize > env.MAX_PDF_FILE_SIZE) {
      throw new AppError('FILE_TOO_LARGE', `The file exceeds the ${Math.round(env.MAX_PDF_FILE_SIZE / 1048576)} MB limit.`, 413);
    }
    let originalFilename: string;
    try {
      originalFilename = sanitizeDisplayFilename(data.fileName);
    } catch {
      throw new AppError('INVALID_FILE_NAME', 'The file name is not valid.', 400);
    }

    const uploadId = crypto.randomUUID();
    const stagingKey = buildStagingKey(this.documentsPrefix, uploadId);
    const upload = await this.storage.generateUploadUrl(stagingKey, PDF_CONTENT_TYPE, env.PRESIGNED_URL_EXPIRATION);
    await this.db.query(
      `INSERT INTO document_uploads (id, staging_key, original_filename, declared_size, content_type, status, created_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, now() + make_interval(secs => $7))`,
      [uploadId, stagingKey, originalFilename, data.fileSize, PDF_CONTENT_TYPE, actor.id, env.PRESIGNED_URL_EXPIRATION + 3600],
    );

    return {
      uploadId,
      uploadUrl: upload.uploadUrl,
      method: 'PUT',
      headers: { 'Content-Type': PDF_CONTENT_TYPE },
      expiresIn: upload.expiresIn,
      maxFileSize: env.MAX_PDF_FILE_SIZE,
    };
  }

  /** Step 2: checks the staged object really is the complete PDF that was declared. Rejected uploads are removed. */
  private async verifyStagedUpload(uploadId: string, actor: DocumentActor) {
    const upload = (
      await this.db.query<UploadRow>(
        `SELECT id, staging_key, original_filename, declared_size, content_type, status, created_by, expires_at < now() AS expired
         FROM document_uploads WHERE id = $1`,
        [uploadId],
      )
    ).rows[0];

    if (!upload) throw new AppError('UPLOAD_NOT_FOUND', 'The upload session was not found. Upload the file again.', 404);
    if (upload.status !== 'pending') throw new AppError('UPLOAD_ALREADY_USED', 'This upload has already been used. Upload the file again.', 409);
    if (upload.created_by !== actor.id && actor.role !== 'admin') throw new AppError('FORBIDDEN', 'This upload belongs to another user.', 403);
    if (upload.expired) throw new AppError('UPLOAD_EXPIRED', 'The upload session has expired. Upload the file again.', 410);

    const head = await this.storage.headObject(upload.staging_key);
    if (!head) {
      throw new AppError('UPLOAD_INCOMPLETE', 'The file has not finished uploading to storage. Retry the upload.', 409);
    }

    const reject = async (code: string, message: string, status: number): Promise<never> => {
      await this.db.query(`UPDATE document_uploads SET status = 'rejected' WHERE id = $1 AND status = 'pending'`, [upload.id]);
      await this.deleteObjectsSafely([upload.staging_key], 'rejected_upload');
      throw new AppError(code, message, status);
    };

    if (head.size !== Number(upload.declared_size)) {
      await reject('UPLOAD_SIZE_MISMATCH', 'The uploaded file is incomplete or does not match the selected file. Upload it again.', 422);
    }
    if (head.size > env.MAX_PDF_FILE_SIZE) {
      await reject('FILE_TOO_LARGE', 'The file exceeds the configured size limit.', 413);
    }

    const [first, last] = await Promise.all([
      this.storage.readObjectRange(upload.staging_key, PDF_HEAD_RANGE),
      this.storage.readObjectRange(upload.staging_key, PDF_TAIL_RANGE),
    ]);
    const check = checkPdfBytes(first, last);
    if (!check.valid) {
      await reject('INVALID_PDF', check.reason, 415);
    }

    return { upload, size: head.size, etag: head.etag };
  }

  // ---------------------------------------------------------------- create / replace

  async createDocument(input: unknown, actor: DocumentActor) {
    const data: CreateDocumentInput = parseInput(createDocumentSchema, input);
    const categories = await this.repository.listCategories();
    const category = await this.requireLeafCategory(data.categoryId, categories);
    const additional = await this.resolveAdditionalPlacements(data.additionalPlacements, category.id, categories);
    const staged = await this.verifyStagedUpload(data.uploadId, actor);

    const displayFilename = this.cleanDisplayFilename(data.displayFilename || staged.upload.original_filename);
    const documentDate = data.documentDate ?? null;
    const financialYear = data.financialYear ?? null;
    const documentId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const objectKey = buildDocumentObjectKey({
      documentsPrefix: this.documentsPrefix,
      categoryPrefix: category.s3_prefix,
      financialYear,
      documentDate,
      documentId,
      version: 1,
      fileName: displayFilename,
    });
    const warnings = await this.findDuplicateWarnings(staged.etag, staged.upload.original_filename, [category.id, ...additional.map((p) => p.categoryId)]);

    await this.storage.copyObject(staged.upload.staging_key, objectKey, PDF_CONTENT_TYPE, buildContentDisposition('inline', displayFilename));

    try {
      await this.db.transaction(async (tx) => {
        await this.claimUpload(tx, staged.upload.id);
        await tx.query(
          `INSERT INTO documents (id, title, original_filename, display_filename, category_id, financial_year, reporting_period,
                                  document_date, status, current_version_id, uploaded_by, updated_by, published_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, CASE WHEN $9 = 'published' THEN now() END)`,
          [documentId, data.title, staged.upload.original_filename, displayFilename, category.id, financialYear,
            data.reportingPeriod || null, documentDate, data.publish ? 'published' : 'draft', versionId, actor.id],
        );
        await tx.query(
          `INSERT INTO document_versions (id, document_id, version, s3_object_key, original_filename, file_size, content_type, etag, uploaded_by)
           VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8)`,
          [versionId, documentId, objectKey, staged.upload.original_filename, staged.size, PDF_CONTENT_TYPE, staged.etag, actor.id],
        );
        await this.writePlacements(tx, documentId, [{ categoryId: category.id, titleOverride: null, displayOrder: data.displayOrder }, ...additional.map((p) => ({ ...p, displayOrder: p.displayOrder ?? data.displayOrder }))]);
        await this.audit.record(actor, {
          action: 'document.created',
          entityType: 'document',
          entityId: documentId,
          details: { title: data.title, categoryId: category.id, objectKey, fileSize: staged.size, status: data.publish ? 'published' : 'draft', warnings },
        }, tx);
      });
    } catch (error) {
      await this.deleteObjectsSafely([objectKey], 'create_failed');
      throw error;
    }

    await this.deleteObjectsSafely([staged.upload.staging_key], 'staging_consumed');
    return { document: await this.getDocument(documentId), warnings };
  }

  /** Replaces the file: the new upload becomes a new immutable version; older versions stay restorable. */
  async replaceFile(documentId: string, input: unknown, actor: DocumentActor) {
    const data = parseInput(replaceFileSchema, input);
    const document = await this.getDocumentRow(documentId);
    if (document.status === 'archived') {
      throw new AppError('DOCUMENT_ARCHIVED', 'Restore the document before replacing its file.', 409);
    }
    const categories = await this.repository.listCategories();
    const category = categories.find((row) => row.id === document.categoryId)!;
    const staged = await this.verifyStagedUpload(data.uploadId, actor);

    const nextVersion = (await this.db.query<{ next: number }>('SELECT coalesce(max(version), 0)::int + 1 AS next FROM document_versions WHERE document_id = $1', [documentId])).rows[0].next;
    const displayFilename = data.keepDisplayFilename ? document.displayFilename : this.cleanDisplayFilename(staged.upload.original_filename);
    const versionId = crypto.randomUUID();
    const objectKey = buildDocumentObjectKey({
      documentsPrefix: this.documentsPrefix,
      categoryPrefix: category.s3_prefix,
      financialYear: document.financialYear,
      documentDate: document.documentDate,
      documentId,
      version: nextVersion,
      fileName: displayFilename,
    });

    await this.storage.copyObject(staged.upload.staging_key, objectKey, PDF_CONTENT_TYPE, buildContentDisposition('inline', displayFilename));

    try {
      await this.db.transaction(async (tx) => {
        await this.claimUpload(tx, staged.upload.id);
        await tx.query(
          `INSERT INTO document_versions (id, document_id, version, s3_object_key, original_filename, file_size, content_type, etag, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [versionId, documentId, nextVersion, objectKey, staged.upload.original_filename, staged.size, PDF_CONTENT_TYPE, staged.etag, actor.id],
        );
        await tx.query(
          `UPDATE documents SET current_version_id = $2, original_filename = $3, display_filename = $4, updated_by = $5, updated_at = now() WHERE id = $1`,
          [documentId, versionId, staged.upload.original_filename, displayFilename, actor.id],
        );
        await this.audit.record(actor, {
          action: 'document.file_replaced',
          entityType: 'document',
          entityId: documentId,
          details: { version: nextVersion, objectKey, previousObjectKey: document.currentVersion?.s3ObjectKey ?? null, fileSize: staged.size },
        }, tx);
      });
    } catch (error) {
      await this.deleteObjectsSafely([objectKey], 'replace_failed');
      throw error;
    }

    await this.deleteObjectsSafely([staged.upload.staging_key], 'staging_consumed');
    return this.getDocument(documentId);
  }

  async restoreVersion(documentId: string, versionId: string, actor: DocumentActor) {
    const document = await this.getDocumentRow(documentId);
    const version = (await this.repository.findVersions(documentId)).find((row) => row.id === versionId);
    if (!version) throw new AppError('VERSION_NOT_FOUND', 'The requested version was not found.', 404);
    if (document.currentVersion?.id === versionId) return this.getDocument(documentId);
    if (!(await this.storage.headObject(version.s3_object_key))) {
      throw new AppError('FILE_UNAVAILABLE', 'The stored file for this version is missing.', 409);
    }

    await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE documents SET current_version_id = $2, original_filename = $3, updated_by = $4, updated_at = now() WHERE id = $1`,
        [documentId, versionId, version.original_filename, actor.id],
      );
      await this.audit.record(actor, {
        action: 'document.version_restored',
        entityType: 'document',
        entityId: documentId,
        details: { version: version.version, previousVersion: document.currentVersion?.version ?? null },
      }, tx);
    });
    return this.getDocument(documentId);
  }

  private async claimUpload(tx: Queryable, uploadId: string) {
    const claimed = await tx.query(`UPDATE document_uploads SET status = 'consumed', consumed_at = now() WHERE id = $1 AND status = 'pending'`, [uploadId]);
    if (claimed.rowCount !== 1) {
      throw new AppError('UPLOAD_ALREADY_USED', 'This upload has already been used. Upload the file again.', 409);
    }
  }

  private cleanDisplayFilename(value: string): string {
    try {
      return sanitizeDisplayFilename(value);
    } catch {
      throw new AppError('INVALID_FILE_NAME', 'The display file name is not valid.', 400);
    }
  }

  private async findDuplicateWarnings(etag: string, originalFilename: string, categoryIds: number[]): Promise<string[]> {
    const rows = (
      await this.db.query<{ title: string; status: string; same_file: boolean }>(
        `SELECT DISTINCT d.title, d.status, (v.etag = $1) AS same_file
         FROM documents d
         JOIN document_versions v ON v.id = d.current_version_id
         LEFT JOIN document_placements p ON p.document_id = d.id
         WHERE d.status <> 'archived'
           AND ((v.etag = $1 AND $1 <> '') OR (lower(d.original_filename) = lower($2) AND p.category_id = ANY($3::int[])))
         LIMIT 5`,
        [etag, originalFilename, categoryIds],
      )
    ).rows;
    return rows.map((row) =>
      row.same_file
        ? `An identical file is already stored as "${row.title}" (${row.status}).`
        : `A document with the same file name already exists in this section: "${row.title}" (${row.status}).`,
    );
  }

  // ---------------------------------------------------------------- placements / metadata

  private async resolveAdditionalPlacements(
    placements: Array<{ categoryId: number; titleOverride?: string | null; displayOrder?: number }>,
    primaryCategoryId: number,
    categories: CategoryRow[],
  ) {
    const seen = new Set<number>([primaryCategoryId]);
    const result: Array<{ categoryId: number; titleOverride: string | null; displayOrder?: number }> = [];
    for (const placement of placements) {
      if (seen.has(placement.categoryId)) continue;
      await this.requireLeafCategory(placement.categoryId, categories);
      seen.add(placement.categoryId);
      result.push({ categoryId: placement.categoryId, titleOverride: placement.titleOverride || null, displayOrder: placement.displayOrder });
    }
    return result;
  }

  private async writePlacements(tx: Queryable, documentId: string, placements: Array<{ categoryId: number; titleOverride: string | null; displayOrder: number }>) {
    for (const placement of placements) {
      await tx.query(
        `INSERT INTO document_placements (document_id, category_id, display_order, title_override) VALUES ($1, $2, $3, $4)
         ON CONFLICT (document_id, category_id) DO UPDATE SET display_order = EXCLUDED.display_order, title_override = EXCLUDED.title_override`,
        [documentId, placement.categoryId, placement.displayOrder, placement.titleOverride],
      );
    }
  }

  async updateDocument(documentId: string, input: unknown, actor: DocumentActor) {
    const data: UpdateDocumentInput = parseInput(updateDocumentSchema, input);
    const current = await this.getDocumentRow(documentId);
    const categories = await this.repository.listCategories();

    const primaryCategoryId = data.categoryId ?? current.categoryId;
    if (data.categoryId !== undefined) await this.requireLeafCategory(data.categoryId, categories);
    const primaryOrder = data.displayOrder ?? current.displayOrder;

    let placements: Array<{ categoryId: number; titleOverride: string | null; displayOrder: number }> | null = null;
    if (data.additionalPlacements !== undefined || data.categoryId !== undefined || data.displayOrder !== undefined) {
      const existing = new Map(current.placements.map((placement) => [placement.categoryId, placement]));
      const requestedAdditional = data.additionalPlacements
        ?? current.placements.filter((placement) => !placement.isPrimary).map((placement) => ({ categoryId: placement.categoryId, titleOverride: placement.titleOverride, displayOrder: placement.displayOrder }));
      const additional = await this.resolveAdditionalPlacements(requestedAdditional, primaryCategoryId, categories);
      placements = [
        { categoryId: primaryCategoryId, titleOverride: null, displayOrder: primaryOrder },
        ...additional.map((placement) => ({
          categoryId: placement.categoryId,
          titleOverride: placement.titleOverride,
          displayOrder: placement.displayOrder ?? existing.get(placement.categoryId)?.displayOrder ?? primaryOrder,
        })),
      ];
    }

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const track = (field: string, from: unknown, to: unknown) => {
      if (to !== undefined && JSON.stringify(from) !== JSON.stringify(to)) changes[field] = { from, to };
    };
    track('title', current.title, data.title);
    track('categoryId', current.categoryId, data.categoryId);
    track('displayFilename', current.displayFilename, data.displayFilename === undefined ? undefined : this.cleanDisplayFilename(data.displayFilename));
    track('financialYear', current.financialYear, data.financialYear);
    track('reportingPeriod', current.reportingPeriod, data.reportingPeriod === undefined ? undefined : data.reportingPeriod || null);
    track('documentDate', current.documentDate, data.documentDate);
    if (placements) {
      track('placements', current.placements.map((p) => [p.categoryId, p.displayOrder, p.titleOverride ?? null]), placements.map((p) => [p.categoryId, p.displayOrder, p.titleOverride]));
    }

    if (Object.keys(changes).length === 0) return this.getDocument(documentId);

    await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE documents SET
           title = coalesce($2, title),
           category_id = $3,
           display_filename = coalesce($4, display_filename),
           financial_year = CASE WHEN $5::boolean THEN $6 ELSE financial_year END,
           reporting_period = CASE WHEN $7::boolean THEN $8 ELSE reporting_period END,
           document_date = CASE WHEN $9::boolean THEN $10::date ELSE document_date END,
           updated_by = $11, updated_at = now()
         WHERE id = $1`,
        [
          documentId,
          data.title ?? null,
          primaryCategoryId,
          data.displayFilename === undefined ? null : this.cleanDisplayFilename(data.displayFilename),
          data.financialYear !== undefined, data.financialYear ?? null,
          data.reportingPeriod !== undefined, data.reportingPeriod || null,
          data.documentDate !== undefined, data.documentDate ?? null,
          actor.id,
        ],
      );
      if (placements) {
        await tx.query('DELETE FROM document_placements WHERE document_id = $1 AND NOT (category_id = ANY($2::int[]))', [documentId, placements.map((p) => p.categoryId)]);
        await this.writePlacements(tx, documentId, placements);
      }
      await this.audit.record(actor, { action: 'document.updated', entityType: 'document', entityId: documentId, details: { changes } }, tx);
    });
    return this.getDocument(documentId);
  }

  // ---------------------------------------------------------------- publishing workflow

  async changeStatus(documentId: string, action: StatusAction, actor: DocumentActor) {
    const transition = STATUS_TRANSITIONS[action];
    const document = await this.getDocumentRow(documentId);
    if (document.status === transition.to) return this.getDocument(documentId);
    if (!transition.from.includes(document.status)) {
      throw new AppError('INVALID_STATUS_TRANSITION', `Cannot ${action} a ${document.status} document.`, 409);
    }

    // Never mark a document published unless its file is actually in storage.
    if (transition.to === 'published') {
      const key = document.currentVersion?.s3ObjectKey;
      const head = key ? await this.storage.headObject(key) : null;
      if (!head) {
        throw new AppError('FILE_UNAVAILABLE', 'The document file is missing from storage. Replace the file before publishing.', 409);
      }
    }

    await this.db.transaction(async (tx) => {
      const updated = await tx.query(
        `UPDATE documents SET status = $2,
           published_at = CASE WHEN $2 = 'published' THEN coalesce(published_at, now()) ELSE published_at END,
           archived_at = CASE WHEN $2 = 'archived' THEN now() WHEN $3 = 'restore' THEN NULL ELSE archived_at END,
           updated_by = $4, updated_at = now()
         WHERE id = $1 AND status = $5`,
        [documentId, transition.to, action, actor.id, document.status],
      );
      if (updated.rowCount !== 1) {
        throw new AppError('CONCURRENT_UPDATE', 'The document was changed by someone else. Refresh and try again.', 409);
      }
      await this.audit.record(actor, { action: transition.audit, entityType: 'document', entityId: documentId, details: { from: document.status, to: transition.to } }, tx);
    });
    return this.getDocument(documentId);
  }

  /** Permanent deletion (admins only). Published documents must be unpublished or archived first. */
  async deleteDocument(documentId: string, actor: DocumentActor) {
    const document = await this.getDocumentRow(documentId);
    if (document.status === 'published') {
      throw new AppError('DOCUMENT_PUBLISHED', 'Unpublish or archive the document before deleting it.', 409);
    }
    const keys = (await this.repository.findVersions(documentId)).map((version) => version.s3_object_key);

    await this.db.transaction(async (tx) => {
      for (const key of keys) {
        await tx.query(
          `INSERT INTO storage_cleanup_queue (s3_object_key, reason) VALUES ($1, 'document_deleted') ON CONFLICT (s3_object_key) DO NOTHING`,
          [key],
        );
      }
      await tx.query('DELETE FROM documents WHERE id = $1', [documentId]);
      await this.audit.record(actor, {
        action: 'document.deleted',
        entityType: 'document',
        entityId: documentId,
        details: { title: document.title, status: document.status, legacyPath: document.legacyPath, objectKeys: keys },
      }, tx);
    });

    await this.processCleanupQueue(keys);
    return { id: documentId, deleted: true };
  }

  // ---------------------------------------------------------------- reads

  private async getDocumentRow(documentId: string): Promise<AdminDocument> {
    if (!/^[0-9a-f-]{36}$/i.test(documentId)) throw notFound();
    const [row] = await this.repository.findDocumentRows('WHERE d.id = $1', [documentId]);
    if (!row) throw notFound();
    const [placements, categories] = await Promise.all([this.repository.findPlacements([documentId]), this.repository.listCategories()]);
    return mapDocument(row, placements, this.categoryPaths(categories));
  }

  async getDocument(documentId: string) {
    const document = await this.getDocumentRow(documentId);
    const versions = (await this.repository.findVersions(documentId)).map(mapVersion);
    return { ...document, versions };
  }

  async listDocuments(query: unknown) {
    const filter: ListDocumentsQuery = parseInput(listDocumentsSchema, query);
    const categories = await this.repository.listCategories();
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.categoryId) {
      const ids = [filter.categoryId, ...categories.filter((row) => row.parent_id === filter.categoryId).map((row) => row.id)];
      params.push(ids);
      conditions.push(`EXISTS (SELECT 1 FROM document_placements p WHERE p.document_id = d.id AND p.category_id = ANY($${params.length}::int[]))`);
    }
    if (filter.status === 'active') {
      conditions.push(`d.status <> 'archived'`);
    } else if (filter.status) {
      params.push(filter.status);
      conditions.push(`d.status = $${params.length}`);
    }
    if (filter.financialYear) {
      params.push(filter.financialYear);
      conditions.push(`d.financial_year = $${params.length}`);
    }
    if (filter.q) {
      params.push(`%${filter.q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`);
      conditions.push(`(d.title ILIKE $${params.length} OR d.original_filename ILIKE $${params.length} OR d.display_filename ILIKE $${params.length})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const total = (await this.db.query<{ total: number }>(`SELECT count(*)::int AS total FROM documents d ${where}`, params)).rows[0].total;
    params.push(filter.pageSize, (filter.page - 1) * filter.pageSize);
    const rows = await this.repository.findDocumentRows(where, params, `ORDER BY d.updated_at DESC, d.id LIMIT $${params.length - 1} OFFSET $${params.length}`);
    const placements = await this.repository.findPlacements(rows.map((row) => row.id));
    const paths = this.categoryPaths(categories);

    return {
      items: rows.map((row) => mapDocument(row, placements, paths)),
      pagination: { page: filter.page, pageSize: filter.pageSize, total, totalPages: Math.max(1, Math.ceil(total / filter.pageSize)) },
    };
  }

  async listFinancialYears(): Promise<string[]> {
    const rows = (await this.db.query<{ financial_year: string }>(`SELECT DISTINCT financial_year FROM documents WHERE financial_year IS NOT NULL ORDER BY financial_year DESC`)).rows;
    return rows.map((row) => row.financial_year);
  }

  /** Short-lived presigned URL so portal users can preview or download any version, published or not. */
  async getAdminFileUrl(documentId: string, options: { versionId?: string; download?: boolean }) {
    const document = await this.getDocument(documentId);
    const version = options.versionId ? document.versions.find((item) => item.id === options.versionId) : document.versions.find((item) => item.id === document.currentVersion?.id);
    if (!version) throw new AppError('VERSION_NOT_FOUND', 'The requested version was not found.', 404);
    const fileName = options.versionId && version.id !== document.currentVersion?.id ? version.originalFilename : document.displayFilename;
    return this.storage.generateDownloadUrl(version.s3ObjectKey, env.PRESIGNED_URL_EXPIRATION, {
      fileName,
      disposition: options.download ? 'attachment' : 'inline',
      contentType: version.contentType,
    });
  }

  // ---------------------------------------------------------------- storage hygiene

  /** Deletes objects; anything that fails is queued in storage_cleanup_queue and retried later. */
  async deleteObjectsSafely(keys: string[], reason: string): Promise<void> {
    if (keys.length === 0) return;
    let failed: string[];
    try {
      failed = await this.storage.deleteObjects(keys);
    } catch {
      failed = keys;
    }
    for (const key of failed) {
      try {
        await this.db.query(
          `INSERT INTO storage_cleanup_queue (s3_object_key, reason) VALUES ($1, $2) ON CONFLICT (s3_object_key) DO NOTHING`,
          [key, reason],
        );
      } catch (error) {
        this.logger.error({ err: error, key, reason }, 'Unable to queue S3 object for cleanup; it may be orphaned');
      }
    }
  }

  /** Retries queued deletions and discards abandoned staging uploads. Safe to run repeatedly. */
  async processCleanupQueue(onlyKeys?: string[]): Promise<{ deleted: number; failed: number; expiredUploads: number }> {
    const queued = onlyKeys
      ? onlyKeys
      : (await this.db.query<{ s3_object_key: string }>('SELECT s3_object_key FROM storage_cleanup_queue ORDER BY created_at LIMIT 500')).rows.map((row) => row.s3_object_key);

    // Never delete an object that is still referenced by a document version.
    const referenced = new Set(
      queued.length
        ? (await this.db.query<{ s3_object_key: string }>('SELECT s3_object_key FROM document_versions WHERE s3_object_key = ANY($1::text[])', [queued])).rows.map((row) => row.s3_object_key)
        : [],
    );
    const deletable = queued.filter((key) => !referenced.has(key));
    if (referenced.size) {
      await this.db.query('DELETE FROM storage_cleanup_queue WHERE s3_object_key = ANY($1::text[])', [[...referenced]]);
    }

    let failed: string[] = [];
    if (deletable.length) {
      try {
        failed = await this.storage.deleteObjects(deletable);
      } catch {
        failed = deletable;
      }
      const succeeded = deletable.filter((key) => !failed.includes(key));
      if (succeeded.length) await this.db.query('DELETE FROM storage_cleanup_queue WHERE s3_object_key = ANY($1::text[])', [succeeded]);
      if (failed.length) await this.db.query(`UPDATE storage_cleanup_queue SET attempts = attempts + 1, last_error = 'delete failed' WHERE s3_object_key = ANY($1::text[])`, [failed]);
    }

    let expiredUploads = 0;
    if (!onlyKeys) {
      const expired = (
        await this.db.query<{ id: string; staging_key: string }>(
          `UPDATE document_uploads SET status = 'rejected' WHERE status = 'pending' AND expires_at < now() RETURNING id, staging_key`,
        )
      ).rows;
      expiredUploads = expired.length;
      await this.deleteObjectsSafely(expired.map((row) => row.staging_key), 'upload_expired');
    }

    return { deleted: deletable.length - failed.length, failed: failed.length, expiredUploads };
  }
}
