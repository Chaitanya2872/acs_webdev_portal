import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TestContext, bearer, createDocument, createTestContext, makePdf, stageUpload } from './helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

const publicList = async (slug: string, query = '') => {
  const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/public/sections/${slug}/documents${query}` });
  expect(response.statusCode).toBe(200);
  return response.json().data as { section: { title: string }; documents: Array<{ id: string; title: string; url: string; type: string; version: number; financialYear: string | null }> };
};

/** Follows the public file redirect and returns the bytes the visitor receives. */
const openPublicFile = async (url: string) => {
  const redirect = await ctx.app.inject({ method: 'GET', url: new URL(url).pathname + new URL(url).search });
  if (redirect.statusCode !== 302) return { status: redirect.statusCode, body: null as Buffer | null, headers: redirect.headers };
  const target = new URL(redirect.headers.location as string);
  const file = await ctx.app.inject({ method: 'GET', url: target.pathname + target.search });
  return { status: file.statusCode, body: file.rawPayload, headers: { ...file.headers, redirectCacheControl: redirect.headers['cache-control'] } };
};

describe('upload and automatic publishing', () => {
  it('stores the PDF in S3, saves metadata, and lists it on the matching website section', async () => {
    const pdf = makePdf('annual-2027');
    const upload = await stageUpload(ctx, ctx.tokens.publisher, pdf, 'Annual Report 2027.pdf');
    const response = await createDocument(ctx, ctx.tokens.publisher, {
      uploadId: upload.uploadId,
      title: 'Annual Report 2027',
      categoryId: await ctx.categoryId('annual-reports'),
      financialYear: '2026-27',
      documentDate: '2027-08-30',
      reportingPeriod: 'FY 2026-27',
      publish: true,
    });
    expect(response.statusCode).toBe(201);
    const { document, warnings } = response.json().data;
    expect(warnings).toEqual([]);
    expect(document).toMatchObject({
      title: 'Annual Report 2027',
      originalFilename: 'Annual Report 2027.pdf',
      displayFilename: 'Annual Report 2027.pdf',
      financialYear: '2026-27',
      documentDate: '2027-08-30',
      status: 'published',
      categoryPath: 'Annual Reports',
    });
    expect(document.currentVersion.s3ObjectKey).toMatch(new RegExp(`^corporate-documents/annual-reports/2026-27/${document.id}/v1-annual-report-2027\\.pdf$`));
    expect(document.currentVersion.fileSize).toBe(pdf.length);

    // File is in storage; the staging copy is gone.
    expect(ctx.storage.getLocalFile(document.currentVersion.s3ObjectKey)?.body.equals(pdf)).toBe(true);
    expect(await ctx.storage.headObject(`corporate-documents/_incoming/${upload.uploadId}.pdf`)).toBeNull();

    const listing = await publicList('annual-reports');
    expect(listing.section.title).toBe('Annual Reports');
    expect(listing.documents[0]).toMatchObject({ id: document.id, title: 'Annual Report 2027', type: 'pdf', financialYear: '2026-27' });
    expect(listing.documents[0].url).toBe(`https://api.test/api/v1/public/documents/${document.id}/file?v=1`);

    const opened = await openPublicFile(listing.documents[0].url);
    expect(opened.status).toBe(200);
    expect(opened.body?.equals(pdf)).toBe(true);
    expect(opened.headers['content-type']).toContain('application/pdf');
    expect(opened.headers['content-disposition']).toContain('inline; filename="Annual Report 2027.pdf"');
    expect(opened.headers.redirectCacheControl).toBe('no-store');
  });

  it('keeps drafts out of public listings until published', async () => {
    const upload = await stageUpload(ctx, ctx.tokens.publisher, makePdf('draft'), 'Presentation.pdf');
    const { document } = (await createDocument(ctx, ctx.tokens.publisher, {
      uploadId: upload.uploadId, title: 'Investor Presentation Q2', categoryId: await ctx.categoryId('investor-presentations'),
    })).json().data;
    expect(document.status).toBe('draft');
    expect((await publicList('investor-presentations')).documents.map((d) => d.id)).not.toContain(document.id);
    expect((await ctx.app.inject({ method: 'GET', url: `/api/v1/public/documents/${document.id}/file` })).statusCode).toBe(404);

    const published = await ctx.app.inject({ method: 'POST', url: `/api/v1/admin/documents/${document.id}/publish`, headers: bearer(ctx.tokens.publisher) });
    expect(published.json().data.status).toBe('published');
    expect((await publicList('investor-presentations')).documents.map((d) => d.id)).toContain(document.id);
  });
});

describe('category mapping', () => {
  it('places documents on their own section and on additional sections with page-specific titles', async () => {
    const upload = await stageUpload(ctx, ctx.tokens.publisher, makePdf('outcome'), 'Outcome of BM 12 Nov 2026.pdf');
    const { document } = (await createDocument(ctx, ctx.tokens.publisher, {
      uploadId: upload.uploadId,
      title: 'Outcome of Board Meeting 12 Nov 2026',
      categoryId: await ctx.categoryId('outcome-of-board-meetings'),
      additionalPlacements: [
        { categoryId: await ctx.categoryId('unaudited-financial-results'), titleOverride: 'Unaudited Financial Results 30 Sep 2026' },
        { categoryId: await ctx.categoryId('regulation-30-disclosures') },
      ],
      publish: true,
    })).json().data;

    expect(document.categoryPath).toBe('Stock Exchange Filings › Outcome of Board Meetings');
    expect(document.currentVersion.s3ObjectKey).toContain('/stock-exchange-filings/board-meetings/outcomes/undated/');
    expect((await publicList('outcome-of-board-meetings')).documents.find((d) => d.id === document.id)?.title).toBe('Outcome of Board Meeting 12 Nov 2026');
    expect((await publicList('unaudited-financial-results')).documents.find((d) => d.id === document.id)?.title).toBe('Unaudited Financial Results 30 Sep 2026');
    expect((await publicList('regulation-30-disclosures')).documents.find((d) => d.id === document.id)?.title).toBe('Outcome of Board Meeting 12 Nov 2026');
    for (const slug of ['annual-reports', 'code-of-conduct', 'audited-financial-results']) {
      expect((await publicList(slug)).documents.map((d) => d.id)).not.toContain(document.id);
    }
  });

  it('rejects parent categories that are not website pages', async () => {
    const upload = await stageUpload(ctx, ctx.tokens.publisher, makePdf('parent'), 'x.pdf');
    const response = await createDocument(ctx, ctx.tokens.publisher, { uploadId: upload.uploadId, title: 'X', categoryId: await ctx.categoryId('stock-exchange-filings') });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('Select a subcategory');
  });

  it('exposes every website section with the existing slugs and titles', async () => {
    const sections = (await ctx.app.inject({ method: 'GET', url: '/api/v1/public/sections' })).json().data as Array<{ slug: string }>;
    expect(sections).toHaveLength(28);
    expect(sections.map((s) => s.slug)).toEqual(expect.arrayContaining(['annual-reports', 'outcome-of-board-meetings', 'iotiq-financials', 'newsletters', 'moa-and-aoa']));
  });

  it('orders by display order, then newest document date', async () => {
    const categoryId = await ctx.categoryId('closure-of-trading-window');
    const make = async (title: string, documentDate: string, displayOrder = 0) => {
      const upload = await stageUpload(ctx, ctx.tokens.publisher, makePdf(title), `${title}.pdf`);
      return (await createDocument(ctx, ctx.tokens.publisher, { uploadId: upload.uploadId, title, categoryId, documentDate, displayOrder, publish: true })).json().data.document.id;
    };
    await make('Closure Q1', '2026-06-30');
    await make('Closure Q2', '2026-09-30');
    await make('Pinned notice', '2020-01-01', -10);
    expect((await publicList('closure-of-trading-window')).documents.map((d) => d.title)).toEqual(['Pinned notice', 'Closure Q2', 'Closure Q1']);
  });
});

describe('replacement and versions', () => {
  it('serves the new file at the same public URL and keeps the old version restorable', async () => {
    const first = makePdf('policy-v1');
    const upload = await stageUpload(ctx, ctx.tokens.publisher, first, 'WHISTLEBLOWER  POLICY(1).pdf');
    const { document } = (await createDocument(ctx, ctx.tokens.publisher, { uploadId: upload.uploadId, title: 'Whistleblower Policy', categoryId: await ctx.categoryId('code-of-conduct'), publish: true })).json().data;
    const url = (await publicList('code-of-conduct')).documents.find((d) => d.id === document.id)!.url;

    const second = makePdf('policy-v2-revised');
    const replacement = await stageUpload(ctx, ctx.tokens.publisher, second, 'Whistleblower Policy revised.pdf');
    const replaced = await ctx.app.inject({ method: 'POST', url: `/api/v1/admin/documents/${document.id}/file`, headers: bearer(ctx.tokens.publisher), payload: { uploadId: replacement.uploadId } });
    expect(replaced.statusCode).toBe(200);
    const updated = replaced.json().data;
    expect(updated.currentVersion.version).toBe(2);
    expect(updated.versions).toHaveLength(2);
    expect(updated.displayFilename).toBe('WHISTLEBLOWER POLICY(1).pdf');
    expect(updated.currentVersion.s3ObjectKey).not.toBe(document.currentVersion.s3ObjectKey);

    // Same listing entry, new version marker, new bytes; the old object is untouched.
    const entry = (await publicList('code-of-conduct')).documents.find((d) => d.id === document.id)!;
    expect(entry.version).toBe(2);
    expect((await openPublicFile(url)).body?.equals(second)).toBe(true);
    expect(ctx.storage.getLocalFile(document.currentVersion.s3ObjectKey)?.body.equals(first)).toBe(true);

    const restored = await ctx.app.inject({ method: 'POST', url: `/api/v1/admin/documents/${document.id}/versions/${document.currentVersion.id}/restore`, headers: bearer(ctx.tokens.publisher) });
    expect(restored.json().data.currentVersion.version).toBe(1);
    expect((await openPublicFile(url)).body?.equals(first)).toBe(true);
  });
});

describe('unpublish, archive and delete', () => {
  it('removes unpublished documents from listings and blocks their file URL', async () => {
    const upload = await stageUpload(ctx, ctx.tokens.publisher, makePdf('notice'), 'Notice.pdf');
    const { document } = (await createDocument(ctx, ctx.tokens.publisher, { uploadId: upload.uploadId, title: 'Notice of EGM', categoryId: await ctx.categoryId('notices'), publish: true })).json().data;
    const url = (await publicList('notices')).documents.find((d) => d.id === document.id)!.url;

    await ctx.app.inject({ method: 'POST', url: `/api/v1/admin/documents/${document.id}/unpublish`, headers: bearer(ctx.tokens.publisher) });
    expect((await publicList('notices')).documents.map((d) => d.id)).not.toContain(document.id);
    expect((await openPublicFile(url)).status).toBe(404);

    // Deleting needs admin rights, and is refused while published.
    await ctx.app.inject({ method: 'POST', url: `/api/v1/admin/documents/${document.id}/publish`, headers: bearer(ctx.tokens.publisher) });
    expect((await ctx.app.inject({ method: 'DELETE', url: `/api/v1/admin/documents/${document.id}`, headers: bearer(ctx.tokens.publisher) })).statusCode).toBe(403);
    const refused = await ctx.app.inject({ method: 'DELETE', url: `/api/v1/admin/documents/${document.id}`, headers: bearer(ctx.tokens.admin) });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('DOCUMENT_PUBLISHED');

    await ctx.app.inject({ method: 'POST', url: `/api/v1/admin/documents/${document.id}/archive`, headers: bearer(ctx.tokens.publisher) });
    const deleted = await ctx.app.inject({ method: 'DELETE', url: `/api/v1/admin/documents/${document.id}`, headers: bearer(ctx.tokens.admin) });
    expect(deleted.statusCode).toBe(200);
    expect(await ctx.storage.headObject(document.currentVersion.s3ObjectKey)).toBeNull();
    expect((await ctx.app.inject({ method: 'GET', url: `/api/v1/admin/documents/${document.id}`, headers: bearer(ctx.tokens.admin) })).statusCode).toBe(404);

    const audit = (await ctx.app.inject({ method: 'GET', url: `/api/v1/admin/documents/${document.id}/audit`, headers: bearer(ctx.tokens.admin) })).json().data as Array<{ action: string; actor: string }>;
    expect(audit.map((entry) => entry.action)).toEqual(['document.deleted', 'document.archived', 'document.published', 'document.unpublished', 'document.created']);
    expect(audit[0].actor).toBe('T-ADMIN');
  });
});

describe('status counts', () => {
  it('counts documents per status for the portal KPI cards', async () => {
    const stats = async () => {
      const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/admin/documents/stats', headers: bearer(ctx.tokens.viewer) });
      expect(response.statusCode).toBe(200);
      return response.json().data as Record<'total' | 'active' | 'draft' | 'published' | 'unpublished' | 'archived', number>;
    };
    const before = await stats();

    const draftUpload = await stageUpload(ctx, ctx.tokens.publisher, makePdf('kpi-draft'), 'KPI Draft.pdf');
    const draft = (await createDocument(ctx, ctx.tokens.publisher, { uploadId: draftUpload.uploadId, title: 'KPI draft', categoryId: await ctx.categoryId('notices') })).json().data.document;
    const liveUpload = await stageUpload(ctx, ctx.tokens.publisher, makePdf('kpi-live'), 'KPI Live.pdf');
    await createDocument(ctx, ctx.tokens.publisher, { uploadId: liveUpload.uploadId, title: 'KPI live', categoryId: await ctx.categoryId('notices'), publish: true });
    await ctx.app.inject({ method: 'POST', url: `/api/v1/admin/documents/${draft.id}/archive`, headers: bearer(ctx.tokens.publisher) });

    const after = await stats();
    expect(after.total - before.total).toBe(2);
    expect(after.active - before.active).toBe(1);
    expect(after.published - before.published).toBe(1);
    expect(after.draft - before.draft).toBe(0);
    expect(after.archived - before.archived).toBe(1);
    expect(after.total).toBe(after.active + after.archived);
  });
});

describe('authorization', () => {
  it('requires a session for every portal route and the right role for changes', async () => {
    const anonymous = [
      ['POST', '/api/v1/admin/document-uploads'],
      ['GET', '/api/v1/admin/documents'],
      ['POST', '/api/v1/admin/documents'],
      ['GET', '/api/v1/files'],
      ['DELETE', '/api/v1/files/general/report.pdf'],
      ['GET', '/api/v1/folders'],
    ] as const;
    for (const [method, url] of anonymous) {
      expect((await ctx.app.inject({ method, url, payload: method === 'GET' ? undefined : {} })).statusCode, `${method} ${url}`).toBe(401);
    }
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/admin/documents', headers: bearer('forged-token') })).statusCode).toBe(401);

    const viewer = bearer(ctx.tokens.viewer);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/admin/documents', headers: viewer })).statusCode).toBe(200);
    expect((await ctx.app.inject({ method: 'POST', url: '/api/v1/admin/document-uploads', headers: viewer, payload: { fileName: 'a.pdf', fileSize: 10, contentType: 'application/pdf' } })).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: 'POST', url: '/api/v1/folders', headers: viewer, payload: { folderName: 'x' } })).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/admin/audit-logs', headers: bearer(ctx.tokens.publisher) })).statusCode).toBe(403);
  });

  it('keeps the generic file manager out of the managed documents prefix', async () => {
    const admin = bearer(ctx.tokens.admin);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/folders/corporate-documents', headers: admin })).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: 'DELETE', url: '/api/v1/folders/corporate-documents', headers: admin })).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: 'POST', url: '/api/v1/files', headers: admin, payload: { folderName: 'corporate-documents/annual-reports', fileName: 'x.pdf', contentType: 'application/pdf', fileSize: 10 } })).statusCode).toBe(403);
    const files = (await ctx.app.inject({ method: 'GET', url: '/api/v1/files', headers: admin })).json().data as Array<{ key: string }>;
    expect(files.some((file) => file.key.startsWith('corporate-documents/'))).toBe(false);
    const folders = (await ctx.app.inject({ method: 'GET', url: '/api/v1/folders', headers: admin })).json().data as Array<{ folderName: string }>;
    expect(folders.map((folder) => folder.folderName)).not.toContain('corporate-documents');
  });

  it('signs in with employee code and OTP, and signs out', async () => {
    const unknown = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { employeeCode: 'NOBODY' } });
    expect(unknown.statusCode).toBe(200);
    expect(ctx.otps.has('NOBODY')).toBe(false);

    await ctx.db.query(`INSERT INTO admin_users (employee_code, name, email, role) VALUES ('T-LOGIN', 'Login Test', 'login@example.com', 'viewer')`);
    const requested = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { employeeCode: 't-login' } });
    expect(requested.json().data.message).toBe('OTP sent to test inbox.');
    // Resending is throttled.
    expect((await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { employeeCode: 'T-LOGIN' } })).statusCode).toBe(429);

    const code = ctx.otps.get('T-LOGIN')!;
    const wrong = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/otp/verify', payload: { employeeCode: 'T-LOGIN', otp: code === '000000' ? '111111' : '000000' } });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe('INVALID_OTP');
    const ok = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/otp/verify', payload: { employeeCode: 'T-LOGIN', otp: code } });
    expect(ok.statusCode).toBe(200);
    const token = ok.json().data.token;
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(token) })).json().data.role).toBe('viewer');
    // A code can only be used once.
    expect((await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/otp/verify', payload: { employeeCode: 'T-LOGIN', otp: code } })).statusCode).toBe(401);
    await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: bearer(token) });
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(token) })).statusCode).toBe(401);
  });
});

describe('error handling', () => {
  const categoryPayload = async () => ({ title: 'Bad', categoryId: await ctx.categoryId('annual-reports'), publish: true });

  it('rejects non-PDF types and oversized files before anything is uploaded', async () => {
    const headers = bearer(ctx.tokens.publisher);
    const docx = await ctx.app.inject({ method: 'POST', url: '/api/v1/admin/document-uploads', headers, payload: { fileName: 'a.docx', fileSize: 10, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } });
    expect(docx.statusCode).toBe(415);
    const disguised = await ctx.app.inject({ method: 'POST', url: '/api/v1/admin/document-uploads', headers, payload: { fileName: 'a.exe', fileSize: 10, contentType: 'application/pdf' } });
    expect(disguised.statusCode).toBe(415);
    const large = await ctx.app.inject({ method: 'POST', url: '/api/v1/admin/document-uploads', headers, payload: { fileName: 'a.pdf', fileSize: 5 * 1048576, contentType: 'application/pdf' } });
    expect(large.statusCode).toBe(413);
  });

  it('validates the uploaded bytes: renamed files, truncated uploads, size mismatches, missing uploads', async () => {
    const fake = await stageUpload(ctx, ctx.tokens.publisher, Buffer.from('<html><body>not a pdf</body></html>'), 'fake.pdf');
    const fakeResponse = await createDocument(ctx, ctx.tokens.publisher, { uploadId: fake.uploadId, ...(await categoryPayload()) });
    expect(fakeResponse.statusCode).toBe(415);
    expect(fakeResponse.json().error.code).toBe('INVALID_PDF');
    expect(await ctx.storage.headObject(`corporate-documents/_incoming/${fake.uploadId}.pdf`)).toBeNull();

    const truncated = await stageUpload(ctx, ctx.tokens.publisher, makePdf('cut').subarray(0, 60), 'cut.pdf');
    expect((await createDocument(ctx, ctx.tokens.publisher, { uploadId: truncated.uploadId, ...(await categoryPayload()) })).json().error.code).toBe('INVALID_PDF');

    const mismatch = await stageUpload(ctx, ctx.tokens.publisher, makePdf('size'), 'size.pdf', 999);
    expect((await createDocument(ctx, ctx.tokens.publisher, { uploadId: mismatch.uploadId, ...(await categoryPayload()) })).json().error.code).toBe('UPLOAD_SIZE_MISMATCH');

    const session = await ctx.app.inject({ method: 'POST', url: '/api/v1/admin/document-uploads', headers: bearer(ctx.tokens.publisher), payload: { fileName: 'never.pdf', fileSize: 100, contentType: 'application/pdf' } });
    const missing = await createDocument(ctx, ctx.tokens.publisher, { uploadId: session.json().data.uploadId, ...(await categoryPayload()) });
    expect(missing.statusCode).toBe(409);
    expect(missing.json().error.code).toBe('UPLOAD_INCOMPLETE');

    const total = await ctx.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM documents WHERE title = 'Bad'`);
    expect(total.rows[0].n).toBe(0);
  });

  it('never reuses an upload and warns about duplicate files without overwriting them', async () => {
    const pdf = makePdf('dup');
    const upload = await stageUpload(ctx, ctx.tokens.publisher, pdf, 'Same Name.pdf');
    const categoryId = await ctx.categoryId('press-and-media-releases');
    const first = await createDocument(ctx, ctx.tokens.publisher, { uploadId: upload.uploadId, title: 'Press release', categoryId });
    expect(first.statusCode).toBe(201);
    expect((await createDocument(ctx, ctx.tokens.publisher, { uploadId: upload.uploadId, title: 'Again', categoryId })).json().error.code).toBe('UPLOAD_ALREADY_USED');

    const again = await stageUpload(ctx, ctx.tokens.publisher, pdf, 'Same Name.pdf');
    const second = await createDocument(ctx, ctx.tokens.publisher, { uploadId: again.uploadId, title: 'Press release copy', categoryId });
    expect(second.statusCode).toBe(201);
    expect(second.json().data.warnings.join(' ')).toContain('identical file');
    expect(second.json().data.document.currentVersion.s3ObjectKey).not.toBe(first.json().data.document.currentVersion.s3ObjectKey);
  });

  it('leaves no record when the S3 copy fails, and no orphaned object when the database write fails', async () => {
    const categoryId = await ctx.categoryId('postal-ballot');
    const copyFailure = await stageUpload(ctx, ctx.tokens.publisher, makePdf('copy-fail'), 'ballot.pdf');
    const copySpy = vi.spyOn(ctx.storage, 'copyObject').mockRejectedValueOnce(new Error('S3 unavailable'));
    const failed = await createDocument(ctx, ctx.tokens.publisher, { uploadId: copyFailure.uploadId, title: 'Ballot A', categoryId, publish: true });
    expect(failed.statusCode).toBe(500);
    copySpy.mockRestore();
    expect((await ctx.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM documents WHERE title = 'Ballot A'`)).rows[0].n).toBe(0);
    // The upload is still pending, so the user can simply retry.
    expect((await createDocument(ctx, ctx.tokens.publisher, { uploadId: copyFailure.uploadId, title: 'Ballot A', categoryId, publish: true })).statusCode).toBe(201);

    const dbFailure = await stageUpload(ctx, ctx.tokens.publisher, makePdf('db-fail'), 'ballot-b.pdf');
    const copyWatch = vi.spyOn(ctx.storage, 'copyObject');
    const txSpy = vi.spyOn(ctx.db, 'transaction').mockRejectedValueOnce(new Error('database unavailable'));
    expect((await createDocument(ctx, ctx.tokens.publisher, { uploadId: dbFailure.uploadId, title: 'Ballot B', categoryId, publish: true })).statusCode).toBe(500);
    expect(copyWatch.mock.calls).toHaveLength(1);
    const copiedKey = copyWatch.mock.calls[0][1];
    txSpy.mockRestore();
    copyWatch.mockRestore();
    expect(copiedKey).toContain('/stock-exchange-filings/postal-ballots/');
    expect(await ctx.storage.headObject(copiedKey)).toBeNull();
  });

  it('refuses to publish a document whose file is missing from storage', async () => {
    const upload = await stageUpload(ctx, ctx.tokens.publisher, makePdf('gone'), 'gone.pdf');
    const { document } = (await createDocument(ctx, ctx.tokens.publisher, { uploadId: upload.uploadId, title: 'Gone', categoryId: await ctx.categoryId('other-filings') })).json().data;
    await ctx.storage.deleteObjects([document.currentVersion.s3ObjectKey]);
    const response = await ctx.app.inject({ method: 'POST', url: `/api/v1/admin/documents/${document.id}/publish`, headers: bearer(ctx.tokens.publisher) });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('FILE_UNAVAILABLE');
  });

  it('validates metadata', async () => {
    const upload = await stageUpload(ctx, ctx.tokens.publisher, makePdf('meta'), 'meta.pdf');
    const categoryId = await ctx.categoryId('annual-reports');
    expect((await createDocument(ctx, ctx.tokens.publisher, { uploadId: upload.uploadId, title: '', categoryId })).statusCode).toBe(400);
    expect((await createDocument(ctx, ctx.tokens.publisher, { uploadId: upload.uploadId, title: 'x', categoryId, financialYear: '2025-27' })).json().error.message).toContain('2025-26');
    expect((await createDocument(ctx, ctx.tokens.publisher, { uploadId: upload.uploadId, title: 'x', categoryId, documentDate: '2026-02-30' })).statusCode).toBe(400);
  });
});

describe('metadata editing', () => {
  it('updates title, dates and sections, and records what changed', async () => {
    const upload = await stageUpload(ctx, ctx.tokens.publisher, makePdf('edit'), 'RPT.pdf');
    const { document } = (await createDocument(ctx, ctx.tokens.publisher, { uploadId: upload.uploadId, title: 'RPT', categoryId: await ctx.categoryId('related-party-transaction'), publish: true })).json().data;
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/documents/${document.id}`,
      headers: bearer(ctx.tokens.publisher),
      payload: { title: 'Related Party Transactions 30 Sep 2026', financialYear: '2026-27', documentDate: '2026-11-14', additionalPlacements: [{ categoryId: await ctx.categoryId('integrated-filing') }] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ title: 'Related Party Transactions 30 Sep 2026', financialYear: '2026-27', documentDate: '2026-11-14' });
    expect((await publicList('integrated-filing')).documents.map((d) => d.id)).toContain(document.id);
    expect((await publicList('related-party-transaction', '?financialYear=2026-27')).documents.map((d) => d.id)).toEqual([document.id]);

    const audit = (await ctx.app.inject({ method: 'GET', url: `/api/v1/admin/documents/${document.id}/audit`, headers: bearer(ctx.tokens.viewer) })).json().data;
    expect(audit[0].action).toBe('document.updated');
    expect(Object.keys(audit[0].details.changes)).toEqual(expect.arrayContaining(['title', 'financialYear', 'documentDate', 'placements']));
  });

  it('lists and filters documents for the portal with pagination', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/admin/documents?categoryId=${await ctx.categoryId('stock-exchange-filings')}&status=published&pageSize=2`, headers: bearer(ctx.tokens.viewer) });
    const data = response.json().data;
    expect(data.items).toHaveLength(2);
    expect(data.pagination.total).toBeGreaterThan(2);
    const search = (await ctx.app.inject({ method: 'GET', url: '/api/v1/admin/documents?q=whistleblower', headers: bearer(ctx.tokens.viewer) })).json().data;
    expect(search.items.map((item: { title: string }) => item.title)).toEqual(['Whistleblower Policy']);
  });

  it('gives portal users a preview URL for any version, including drafts', async () => {
    const upload = await stageUpload(ctx, ctx.tokens.publisher, makePdf('preview'), 'Préavis – AGM.pdf');
    const { document } = (await createDocument(ctx, ctx.tokens.publisher, { uploadId: upload.uploadId, title: 'Preview', categoryId: await ctx.categoryId('notices') })).json().data;
    const link = (await ctx.app.inject({ method: 'GET', url: `/api/v1/admin/documents/${document.id}/file-url?download=true`, headers: bearer(ctx.tokens.viewer) })).json().data;
    const target = new URL(link.downloadUrl);
    const file = await ctx.app.inject({ method: 'GET', url: target.pathname + target.search });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-disposition']).toBe(`attachment; filename="Preavis  AGM.pdf"; filename*=UTF-8''Pr%C3%A9avis%20%E2%80%93%20AGM.pdf`);
  });
});

describe('public API contract', () => {
  it('allows any origin on public routes but only portal origins on admin routes', async () => {
    const pub = await ctx.app.inject({ method: 'GET', url: '/api/v1/public/sections', headers: { origin: 'https://www.acstechnologies.co.in' } });
    expect(pub.headers['access-control-allow-origin']).toBe('*');
    expect(pub.headers['cache-control']).toBe('public, max-age=0, s-maxage=60');
    const admin = await ctx.app.inject({ method: 'GET', url: '/api/v1/admin/documents', headers: { origin: 'https://evil.example', ...bearer(ctx.tokens.viewer) } });
    expect(admin.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('returns 404 for unknown sections and documents', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/public/sections/not-a-page/documents' })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/public/sections/stock-exchange-filings/documents' })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/v1/public/documents/00000000-0000-0000-0000-000000000000/file' })).statusCode).toBe(404);
  });
});
