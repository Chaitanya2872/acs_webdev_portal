import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import { Database, createDatabase } from '../../src/db/database';
import { runMigrations } from '../../src/db/migrate';
import { AuditService } from '../../src/modules/audit/audit.service';
import { AuthService, Role } from '../../src/modules/auth/auth.service';
import { MemoryStorageService } from '../../src/services/memory-storage.service';

/** A tiny but structurally valid PDF; `marker` makes each file's bytes (and ETag) distinct. */
export function makePdf(marker = 'test'): Buffer {
  return Buffer.from(
    `%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\n% ${marker}\ntrailer << /Root 1 0 R >>\n%%EOF\n`,
    'latin1',
  );
}

export type TestContext = {
  app: FastifyInstance;
  db: Database;
  storage: MemoryStorageService;
  otps: Map<string, string>;
  tokens: Record<Role, string>;
  categoryId: (slug: string) => Promise<number>;
  close: () => Promise<void>;
};

export async function createTestContext(): Promise<TestContext> {
  const db = await createDatabase('pglite:memory');
  await runMigrations(db);
  const storage = new MemoryStorageService();
  const otps = new Map<string, string>();
  const otpDelivery = { send: async (recipient: { employeeCode: string }, code: string) => { otps.set(recipient.employeeCode, code); return 'test inbox'; } };
  const app = await buildApp({ database: db, storage, otpDelivery, logger: false, cleanupIntervalMs: 0 });
  await app.ready();

  const auth = new AuthService(db, new AuditService(db), otpDelivery);
  const tokens = {} as Record<Role, string>;
  for (const role of ['admin', 'publisher', 'viewer'] as Role[]) {
    const code = `T-${role.toUpperCase()}`;
    await auth.upsertUser({ employeeCode: code, name: `Test ${role}`, email: `${role}@example.com`, role });
    await auth.requestOtp(code, '127.0.0.1');
    const session = await auth.verifyOtp(code, otps.get(code)!, { ip: '127.0.0.1', userAgent: 'vitest' });
    tokens[role] = session.token;
  }

  return {
    app,
    db,
    storage,
    otps,
    tokens,
    categoryId: async (slug) => (await db.query<{ id: number }>('SELECT id FROM document_categories WHERE slug = $1', [slug])).rows[0].id,
    close: async () => {
      await app.close();
      await db.close();
    },
  };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** Runs the browser's part of an upload: request a session, then PUT the bytes to the presigned URL. */
export async function stageUpload(ctx: TestContext, token: string, body: Buffer, fileName = 'Annual Report 2027.pdf', declaredSize = body.length) {
  const session = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/admin/document-uploads',
    headers: bearer(token),
    payload: { fileName, fileSize: declaredSize, contentType: 'application/pdf' },
  });
  if (session.statusCode !== 201) throw new Error(`upload session failed: ${session.body}`);
  const data = session.json().data as { uploadId: string; uploadUrl: string };
  const url = new URL(data.uploadUrl);
  const put = await ctx.app.inject({ method: 'PUT', url: url.pathname, headers: { 'content-type': 'application/pdf' }, payload: body });
  if (put.statusCode !== 200) throw new Error(`upload PUT failed: ${put.body}`);
  return data;
}

export async function createDocument(ctx: TestContext, token: string, payload: Record<string, unknown>) {
  return ctx.app.inject({ method: 'POST', url: '/api/v1/admin/documents', headers: bearer(token), payload });
}
