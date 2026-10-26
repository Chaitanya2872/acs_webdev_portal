import Fastify, { FastifyInstance, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import Swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import rateLimit from '@fastify/rate-limit';
import { allowedOrigins } from './config/aws';
import { env, shouldAutoMigrate, validateProductionSecurityConfig, validateRequiredAwsConfig } from './config/env';
import { Database, createDatabase } from './db/database';
import { runMigrations } from './db/migrate';
import errorHandler from './middleware/error-handler';
import { AuditService } from './modules/audit/audit.service';
import { createAuthGuards } from './modules/auth/auth.guard';
import { authRoutes } from './modules/auth/auth.routes';
import { AuthService } from './modules/auth/auth.service';
import { OtpDelivery, createOtpDelivery } from './modules/auth/otp-delivery';
import { documentAdminRoutes } from './modules/documents/document.routes';
import { DocumentService } from './modules/documents/document.service';
import { PublicDocumentService } from './modules/documents/public-document.service';
import { publicDocumentRoutes } from './modules/documents/public.routes';
import { fileRoutes } from './modules/files/file.routes';
import { folderRoutes } from './modules/folders/folder.routes';
import { S3Service } from './services/s3.service';
import { MemoryStorageService } from './services/memory-storage.service';
import { createSuccessResponse } from './utils/response';

export type BuildAppOptions = {
  /** Injected in tests; otherwise created from DATABASE_URL. */
  database?: Database;
  storage?: S3Service;
  otpDelivery?: OtpDelivery;
  logger?: boolean;
  /** Background cleanup of abandoned uploads and queued S3 deletions (disabled in tests). */
  cleanupIntervalMs?: number;
};

const PUBLIC_API_PREFIX = '/api/v1/public/';

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  validateProductionSecurityConfig();

  const app = Fastify({
    logger: options.logger === false
      ? false
      : {
          level: env.NODE_ENV === 'production' ? 'info' : 'debug',
          transport: env.NODE_ENV !== 'production' ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
        },
    requestIdHeader: 'x-request-id',
    genReqId: () => `req_${Math.random().toString(36).slice(2, 10)}`,
    trustProxy: env.TRUST_PROXY,
  });

  const memoryStorage = options.storage
    ? options.storage instanceof MemoryStorageService ? options.storage : null
    : env.STORAGE_MODE === 'memory' ? new MemoryStorageService() : null;
  if (!options.storage && !memoryStorage) {
    validateRequiredAwsConfig();
  }
  const storage = options.storage ?? memoryStorage ?? new S3Service();
  app.decorate('s3Service', storage);

  const database = options.database ?? (await createDatabase(env.DATABASE_URL));
  if (!options.database) {
    app.addHook('onClose', async () => database.close());
  }
  if (shouldAutoMigrate) {
    const applied = await runMigrations(database);
    if (applied.length) app.log.info({ applied }, 'Database migrations applied');
  }

  const audit = new AuditService(database);
  const authService = new AuthService(database, audit, options.otpDelivery ?? createOtpDelivery(app.log));
  const guards = createAuthGuards(authService);
  const documentService = new DocumentService(database, storage, audit, app.log);
  const publicDocumentService = new PublicDocumentService(database, storage);

  if (memoryStorage) {
    app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
    app.put('/api/v1/local-storage/*', { bodyLimit: env.MAX_FILE_SIZE }, async (request, reply) => {
      const objectKey = (request.params as { '*': string })['*'];
      if (!objectKey || objectKey.startsWith('/') || objectKey.includes('..')) {
        return reply.code(400).send({ success: false, error: { message: 'Invalid object key.' } });
      }

      memoryStorage.uploadLocalFile(objectKey, request.body as Buffer, request.headers['content-type'] ?? 'application/octet-stream');
      return reply.code(200).send({ success: true });
    });
    app.get('/api/v1/local-storage/*', async (request, reply) => {
      const objectKey = (request.params as { '*': string })['*'];
      if (!objectKey || objectKey.startsWith('/') || objectKey.includes('..')) {
        return reply.code(400).send({ success: false, error: { message: 'Invalid object key.' } });
      }

      const file = memoryStorage.getLocalFile(objectKey);
      if (!file) {
        return reply.code(404).send({ success: false, error: { message: 'File not found.' } });
      }
      // Mirror S3's response-content-* overrides used by presigned download URLs.
      const query = request.query as Record<string, string | undefined>;
      if (query['response-content-disposition']) reply.header('Content-Disposition', query['response-content-disposition']);
      return reply.type(query['response-content-type'] ?? file.contentType).send(file.body);
    });
  }

  // The public document API is read by the corporate website from any origin without credentials;
  // everything else is restricted to the configured portal origins.
  await app.register(cors, {
    delegator: (request: FastifyRequest, callback: (error: Error | null, options: Record<string, unknown>) => void) => {
      if ((request.url ?? '').startsWith(PUBLIC_API_PREFIX)) {
        callback(null, { origin: '*', methods: ['GET', 'HEAD', 'OPTIONS'], credentials: false, maxAge: 600 });
        return;
      }
      callback(null, { origin: allowedOrigins, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], credentials: true });
    },
  } as never);

  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
  });

  await app.register(Swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'S3 File API',
        version: '1.0.0',
        description: 'REST API for managing S3-backed folders and files.',
      },
      servers: [{ url: `http://localhost:${env.PORT}` }],
      tags: [{ name: 'Health' }, { name: 'Auth' }, { name: 'Folders' }, { name: 'Files' }, { name: 'Documents (admin)' }, { name: 'Documents (public)' }],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      deepLinking: false,
    },
  });

  // Set on the root instance (not via register, which would encapsulate it) so it applies to every route.
  await errorHandler(app);

  app.get('/', {
    schema: {
      tags: ['Health'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                status: { type: 'string' },
                service: { type: 'string' },
              },
            },
          },
        },
      },
    },
    handler: async () => createSuccessResponse({ status: 'ok', service: 's3-file-api' }),
  });

  app.get('/health', {
    schema: {
      tags: ['Health'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                status: { type: 'string' },
                service: { type: 'string' },
              },
            },
          },
        },
      },
    },
    handler: async () => createSuccessResponse({ status: 'ok', service: 's3-file-api' }),
  });

  app.get('/health/ready', {
    schema: {
      tags: ['Health'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                status: { type: 'string' },
              },
            },
          },
        },
      },
    },
    handler: async () => {
      if (env.STORAGE_MODE === 's3') {
        validateRequiredAwsConfig();
      }
      await database.query('SELECT 1');
      return createSuccessResponse({ status: 'ready' });
    },
  });

  await app.register(authRoutes(authService, guards));

  // The generic file manager requires a signed-in user; changes need publisher or admin rights.
  await app.register(async (scope) => {
    scope.addHook('preHandler', async (request, reply) => {
      const guard = request.method === 'GET' || request.method === 'HEAD' ? guards.anyUser : guards.canPublish;
      await guard(request, reply);
    });
    await scope.register(folderRoutes);
    await scope.register(fileRoutes);
  });

  await app.register(documentAdminRoutes(documentService, audit, guards));
  await app.register(publicDocumentRoutes(publicDocumentService));

  if (options.cleanupIntervalMs !== 0) {
    const runCleanup = () =>
      documentService.processCleanupQueue().then(
        (result) => (result.deleted || result.failed || result.expiredUploads) && app.log.info(result, 'Storage cleanup completed'),
        (error) => app.log.error({ err: error }, 'Storage cleanup failed'),
      );
    const timer = setInterval(runCleanup, options.cleanupIntervalMs ?? 15 * 60 * 1000);
    timer.unref();
    app.addHook('onReady', async () => {
      void runCleanup();
    });
    app.addHook('onClose', async () => clearInterval(timer));
  }

  return app;
}
