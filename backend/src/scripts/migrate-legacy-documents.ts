/**
 * One-off (and safely repeatable) import of the corporate website's existing filings into S3 + the database.
 *
 *   npm run documents:migrate-legacy -- --website ../../acs-web --dry-run
 *   npm run documents:migrate-legacy -- --website ../../acs-web --check-live https://www.acstechnologies.co.in
 *
 * Reads the curated document lists from <website>/src/data/investorDocuments.js and the files from <website>/public.
 * Nothing on the website is modified or deleted.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { env, validateRequiredAwsConfig } from '../config/env';
import { createDatabase } from '../db/database';
import { runMigrations } from '../db/migrate';
import { WebsiteDocumentPage, migrateLegacyDocuments } from '../modules/documents/legacy-migration';
import { S3Service } from '../services/s3.service';

// A real dynamic import (TypeScript would otherwise compile import() to require(), which cannot load the site's ES module).
const importModule = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<Record<string, unknown>>;

async function main() {
  const { values } = parseArgs({
    options: {
      website: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      unpublished: { type: 'boolean', default: false },
      report: { type: 'string', default: 'legacy-migration-report.json' },
      'check-live': { type: 'string' },
    },
  });
  if (!values.website) {
    throw new Error('Usage: npm run documents:migrate-legacy -- --website <path to acs-web> [--dry-run] [--unpublished] [--report file.json] [--check-live https://www.acstechnologies.co.in]');
  }

  const websiteRoot = path.resolve(values.website);
  const dataFile = path.join(websiteRoot, 'src', 'data', 'investorDocuments.js');
  if (!fs.existsSync(dataFile)) throw new Error(`Not found: ${dataFile}`);
  const { documentPages } = (await importModule(pathToFileURL(dataFile).href)) as { documentPages: WebsiteDocumentPage[] };

  if (!values['dry-run']) {
    if (env.STORAGE_MODE !== 's3') throw new Error('STORAGE_MODE must be s3 to migrate documents (use --dry-run to preview).');
    validateRequiredAwsConfig();
  }

  const liveBase = values['check-live']?.replace(/\/+$/, '');
  const db = await createDatabase(env.DATABASE_URL);
  try {
    await runMigrations(db);
    const report = await migrateLegacyDocuments(db, new S3Service(), {
      pages: documentPages,
      publicDir: path.join(websiteRoot, 'public'),
      documentsPrefix: env.S3_DOCUMENTS_PREFIX,
      dryRun: values['dry-run'],
      publish: !values.unpublished,
      checkLive: liveBase ? async (legacyPath) => (await fetch(`${liveBase}${encodeURI(legacyPath)}`, { method: 'HEAD' })).status : undefined,
      log: (message) => console.log(message),
    });

    fs.writeFileSync(values.report!, JSON.stringify(report, null, 2));
    const { website, results } = report;
    console.log([
      '',
      `Website pages: ${website.pages}, document links: ${website.references}, unique files: ${website.uniqueFiles}, files on disk: ${website.filesOnDisk}`,
      `Migrated: ${results.migrated}, already migrated: ${results.alreadyMigrated}, failed: ${results.failed}`,
      `S3 objects uploaded: ${results.uploadedObjects}, reused: ${results.reusedObjects}, repaired: ${results.repairedObjects}`,
      `Files listed on several pages: ${report.sharedReferences.length}, identical-content groups: ${report.contentDuplicates.length}`,
      `Unreferenced files on disk (not migrated): ${report.unreferencedFiles.length}`,
      liveBase ? `Broken live links: ${report.brokenLiveLinks.length}` : 'Live links not checked (use --check-live <url>)',
      report.unmappedPages.length ? `Pages without a category: ${report.unmappedPages.join(', ')}` : 'All website pages map to a category.',
      `${values['dry-run'] ? 'DRY RUN - nothing was written. ' : ''}Full report: ${path.resolve(values.report!)}`,
    ].join('\n'));
    if (results.failed > 0) process.exitCode = 2;
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
