import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import Swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import rateLimit from '@fastify/rate-limit';
import { allowedOrigins } from './config/aws';
import { env, validateRequiredAwsConfig } from './config/env';
import errorHandler from './middleware/error-handler';
import { fileRoutes } from './modules/files/file.routes';
import { folderRoutes } from './modules/folders/folder.routes';
import { S3Service } from './services/s3.service';
import { MemoryStorageService } from './services/memory-storage.service';
import { createSuccessResponse } from './utils/response';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport: env.NODE_ENV !== 'production' ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
    },
    requestIdHeader: 'x-request-id',
    genReqId: () => `req_${Math.random().toString(36).slice(2, 10)}`,
  });

  const memoryStorage = env.STORAGE_MODE === 'memory' ? new MemoryStorageService() : null;
  if (!memoryStorage) {
    validateRequiredAwsConfig();
  }

  app.decorate('s3Service', memoryStorage ?? new S3Service());

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
      return reply.type(file.contentType).send(file.body);
    });
  }

  await app.register(cors, {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  await app.register(rateLimit, {
    global: true,
    max: 100,
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
      tags: [{ name: 'Health' }, { name: 'Folders' }, { name: 'Files' }],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      deepLinking: false,
    },
  });

  await app.register(errorHandler);

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
      return createSuccessResponse({ status: 'ready' });
    },
  });

  await app.register(folderRoutes);
  await app.register(fileRoutes);

  return app;
}
