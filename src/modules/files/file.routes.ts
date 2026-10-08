import { FastifyInstance } from 'fastify';
import { S3Service } from '../../services/s3.service';
import { FileController } from './file.controller';
import { FileService } from './file.service';

export async function fileRoutes(fastify: FastifyInstance) {
  const controller = new FileController(new FileService(fastify.s3Service ?? new S3Service()));

  fastify.post('/api/v1/files', {
    schema: {
      tags: ['Files'],
      body: {
        type: 'object',
        required: ['folderName', 'fileName', 'contentType', 'fileSize'],
        properties: {
          folderName: { type: 'string' },
          fileName: { type: 'string' },
          contentType: { type: 'string' },
          fileSize: { type: 'number' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                key: { type: 'string' },
                fileName: { type: 'string' },
                uploadUrl: { type: 'string' },
                expiresIn: { type: 'number' },
              },
            },
          },
        },
      },
    },
    handler: controller.createUploadRequest.bind(controller),
  });

  fastify.get('/api/v1/files', {
    schema: {
      tags: ['Files'],
      querystring: {
        type: 'object',
        properties: {
          folderName: { type: 'string' },
          limit: { type: 'number' },
          continuationToken: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              fileName: { type: 'string' },
              size: { type: 'number' },
              contentType: { type: 'string' },
              lastModified: { type: 'string' },
            },
          },
        },
      },
    },
    handler: controller.listFiles.bind(controller),
  });

  fastify.get('/api/v1/files/*', {
    schema: {
      tags: ['Files'],
      params: {
        type: 'object',
        required: ['*'],
        properties: {
          '*': { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                key: { type: 'string' },
                fileName: { type: 'string' },
                size: { type: 'number' },
                contentType: { type: 'string' },
                downloadUrl: { type: 'string' },
                expiresIn: { type: 'number' },
              },
            },
          },
        },
      },
    },
    handler: controller.getFile.bind(controller),
  });

  fastify.put('/api/v1/files/*', {
    schema: {
      tags: ['Files'],
      params: {
        type: 'object',
        required: ['*'],
        properties: {
          '*': { type: 'string' },
        },
      },
      body: {
        type: 'object',
        properties: {
          fileName: { type: 'string' },
          contentType: { type: 'string' },
          fileSize: { type: 'number' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                key: { type: 'string' },
                fileName: { type: 'string' },
                uploadUrl: { type: 'string' },
                expiresIn: { type: 'number' },
              },
            },
          },
        },
      },
    },
    handler: controller.replaceFile.bind(controller),
  });

  fastify.delete('/api/v1/files/*', {
    schema: {
      tags: ['Files'],
      params: {
        type: 'object',
        required: ['*'],
        properties: {
          '*': { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: controller.deleteFile.bind(controller),
  });
}
