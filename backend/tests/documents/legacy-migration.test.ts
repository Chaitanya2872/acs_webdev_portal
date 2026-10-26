import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebsiteDocumentPage, migrateLegacyDocuments } from '../../src/modules/documents/legacy-migration';
import { TestContext, createTestContext, makePdf } from './helpers';

let ctx: TestContext;
let publicDir: string;

const pages: WebsiteDocumentPage[] = [
  {
    slug: 'outcome-of-board-meetings',
    title: 'Outcome of Board Meetings',
    documents: [
      { title: 'Outcome of Board Meeting 13 Aug 2026', href: '/assets/docs/Outcome of board meetings/Outcome of Board Meeting - 13 August 2026.pdf', type: 'pdf' },
      { title: 'Outcome of Board Meeting 03 Jul 2026', href: '/assets/docs/Outcome of board meetings/Outcome of Board Meeting 03.07.2026.pdf', type: 'pdf' },
    ],
  },
  {
    // The same filing listed again under a different title, as on the real website.
    slug: 'unaudited-financial-results',
    title: 'Unaudited Financial Results',
    documents: [
      { title: 'Unaudited Financial Results 30 June 2026', href: '/assets/docs/Outcome%20of%20board%20meetings/Outcome%20of%20Board%20Meeting%20-%2013%20August%202026.pdf', type: 'pdf' },
      { title: 'Unaudited Financial Results 30 June 2026 (copy)', href: '/assets/docs/Financial Results/Copy.pdf', type: 'pdf' },
    ],
  },
  {
    slug: 'corporate-governance',
    title: 'Corporate Governance',
    documents: [
      { title: 'Corporate Governance report 31 December 2024', href: '/assets/docs/Corporate governence/CG Dec 2024.html', type: 'html' },
      { title: 'Missing file', href: '/assets/docs/Corporate governence/missing.pdf', type: 'pdf' },
    ],
  },
  { slug: 'not-a-real-page', title: 'Unknown', documents: [{ title: 'x', href: '/assets/docs/x.pdf' }] },
];

const write = (relative: string, body: Buffer | string) => {
  const target = path.join(publicDir, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body);
};

beforeAll(async () => {
  ctx = await createTestContext();
  publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acs-legacy-'));
  const outcome = makePdf('outcome-13-aug');
  write('assets/docs/Outcome of board meetings/Outcome of Board Meeting - 13 August 2026.pdf', outcome);
  write('assets/docs/Outcome of board meetings/Outcome of Board Meeting 03.07.2026.pdf', makePdf('outcome-03-jul'));
  write('assets/docs/Financial Results/Copy.pdf', outcome);
  write('assets/docs/Corporate governence/CG Dec 2024.html', '<html><body>XBRL report</body></html>');
  write('assets/docs/Notices/Unlisted.pdf', makePdf('unlisted'));
});

afterAll(async () => {
  await ctx.close();
  fs.rmSync(publicDir, { recursive: true, force: true });
});

const run = (dryRun = false) => migrateLegacyDocuments(ctx.db, ctx.storage, { pages, publicDir, documentsPrefix: 'corporate-documents', dryRun });

describe('legacy document migration', () => {
  it('previews without writing anything', async () => {
    const report = await run(true);
    expect(report.results.migrated).toBe(0);
    expect((await ctx.db.query<{ n: number }>('SELECT count(*)::int AS n FROM documents')).rows[0].n).toBe(0);
  });

  it('migrates each unique file once, keeps every page placement, title and order, and reports problems', async () => {
    const report = await run();
    expect(report.website).toMatchObject({ references: 6, uniqueFiles: 5, filesOnDisk: 5 });
    expect(report.results).toMatchObject({ migrated: 4, uploadedObjects: 4, failed: 1 });
    expect(report.unmappedPages).toEqual(['not-a-real-page']);
    expect(report.failures).toEqual([{ legacyPath: '/assets/docs/Corporate governence/missing.pdf', reason: 'File not found in website public/ folder' }]);
    expect(report.sharedReferences).toEqual([{ legacyPath: '/assets/docs/Outcome of board meetings/Outcome of Board Meeting - 13 August 2026.pdf', pages: ['outcome-of-board-meetings', 'unaudited-financial-results'] }]);
    expect(report.contentDuplicates).toHaveLength(1);
    expect(report.contentDuplicates[0].legacyPaths).toHaveLength(2);
    expect(report.unreferencedFiles).toEqual(['/assets/docs/Notices/Unlisted.pdf']);

    const shared = report.documents.find((doc) => doc.legacyPath.endsWith('13 August 2026.pdf'))!;
    expect(shared).toMatchObject({ primarySection: 'outcome-of-board-meetings', otherSections: ['unaudited-financial-results'], documentDate: '2026-08-13', financialYear: '2026-27', status: 'migrated' });
    expect(shared.objectKey).toMatch(/^corporate-documents\/stock-exchange-filings\/board-meetings\/outcomes\/2026-27\/[0-9a-f-]{36}\/v1-outcome-of-board-meeting-13-august-2026\.pdf$/);
    expect(await ctx.storage.headObject(shared.objectKey)).not.toBeNull();

    const outcomes = (await ctx.app.inject({ method: 'GET', url: '/api/v1/public/sections/outcome-of-board-meetings/documents' })).json().data.documents;
    expect(outcomes.map((doc: { title: string }) => doc.title)).toEqual(['Outcome of Board Meeting 13 Aug 2026', 'Outcome of Board Meeting 03 Jul 2026']);
    const results = (await ctx.app.inject({ method: 'GET', url: '/api/v1/public/sections/unaudited-financial-results/documents' })).json().data.documents;
    expect(results.map((doc: { title: string }) => doc.title)).toEqual(['Unaudited Financial Results 30 June 2026', 'Unaudited Financial Results 30 June 2026 (copy)']);
    expect(results[0].id).toBe(outcomes[0].id);

    const governance = (await ctx.app.inject({ method: 'GET', url: '/api/v1/public/sections/corporate-governance/documents' })).json().data.documents;
    expect(governance).toMatchObject([{ title: 'Corporate Governance report 31 December 2024', type: 'html' }]);
  });

  it('is idempotent: a second run creates no records and uploads nothing', async () => {
    const before = (await ctx.db.query<{ n: number }>('SELECT count(*)::int AS n FROM documents')).rows[0].n;
    const report = await run();
    expect(report.results).toMatchObject({ migrated: 0, alreadyMigrated: 4, uploadedObjects: 0 });
    expect((await ctx.db.query<{ n: number }>('SELECT count(*)::int AS n FROM documents')).rows[0].n).toBe(before);
  });

  it('re-uploads an object that went missing from S3 and keeps old URLs resolvable', async () => {
    const first = (await run(true)).documents.find((doc) => doc.legacyPath.endsWith('03.07.2026.pdf'))!;
    await ctx.storage.deleteObjects([first.objectKey]);
    const report = await run();
    expect(report.results.repairedObjects).toBe(1);
    expect(await ctx.storage.headObject(first.objectKey)).not.toBeNull();

    const legacy = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/public/legacy-documents?format=json&path=${encodeURIComponent('/assets/docs/Outcome of board meetings/Outcome of Board Meeting 03.07.2026.pdf')}`,
    });
    expect(legacy.json().data).toMatchObject({ id: first.documentId, url: `https://api.test/api/v1/public/documents/${first.documentId}/file?v=1` });
    const redirect = await ctx.app.inject({ method: 'GET', url: `/api/v1/public/legacy-documents?path=${encodeURIComponent('/assets/docs/outcome of board meetings/outcome of board meeting 03.07.2026.pdf')}` });
    expect(redirect.statusCode).toBe(302);
  });
});
