import { FastifyInstance } from 'fastify';
import { S3Service } from '../../services/s3.service';
import { FolderController } from './folder.controller';
import { FolderService } from './folder.service';

export async function folderRoutes(fastify: FastifyInstance) {
  const controller = new FolderController(new FolderService(fastify.s3Service ?? new S3Service()));

  fastify.post('/api/v1/folders', {
    schema: {
      tags: ['Folders'],
      body: {
        type: 'object',
        required: ['folderName'],
        properties: {
          folderName: { type: 'string' },
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
                folderName: { type: 'string' },
              },
            },
          },
        },
      },
    },
    handler: controller.createFolder.bind(controller),
  });

  fastify.get('/api/v1/folders', {
    schema: {
      tags: ['Folders'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  folderName: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    handler: controller.listFolders.bind(controller),
  });

  fastify.get('/api/v1/folders/*', {
    schema: {
      tags: ['Folders'],
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
                folderName: { type: 'string' },
                folders: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { folderName: { type: 'string' } },
                  },
                },
                files: {
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
          },
        },
      },
    },
    handler: controller.getFolderContents.bind(controller),
  });

  fastify.put('/api/v1/folders/*', {
    schema: {
      tags: ['Folders'],
      params: {
        type: 'object',
        required: ['*'],
        properties: { '*': { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['newName'],
        properties: { newName: { type: 'string', minLength: 1 } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', properties: { folderName: { type: 'string' } } },
          },
        },
      },
    },
    handler: controller.renameFolder.bind(controller),
  });

  fastify.delete('/api/v1/folders/*', {
    schema: {
      tags: ['Folders'],
      params: {
        type: 'object',
        required: ['*'],
        properties: { '*': { type: 'string' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', properties: { folderName: { type: 'string' } } },
          },
        },
      },
    },
    handler: controller.deleteFolder.bind(controller),
  });
}
