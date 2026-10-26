import { FastifyInstance, FastifyRequest } from 'fastify';
import { createSuccessResponse } from '../../utils/response';
import { AuditService } from '../audit/audit.service';
import { AuthGuards, actorFromRequest } from '../auth/auth.guard';
import { DocumentActor, DocumentService } from './document.service';

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
};

const actor = (request: FastifyRequest): DocumentActor => ({ ...actorFromRequest(request), role: request.user!.role });

/** Portal API for managing website documents. Every route requires a signed-in portal user. */
export function documentAdminRoutes(service: DocumentService, audit: AuditService, guards: AuthGuards) {
  return async function registerDocumentAdminRoutes(fastify: FastifyInstance) {
    const tags = ['Documents (admin)'];

    fastify.get('/api/v1/admin/document-categories', {
      preHandler: guards.anyUser,
      schema: { tags },
      handler: async () => createSuccessResponse(await service.getCategoryTree()),
    });

    fastify.get('/api/v1/admin/documents', {
      preHandler: guards.anyUser,
      schema: { tags },
      handler: async (request) => createSuccessResponse(await service.listDocuments(request.query)),
    });

    fastify.get('/api/v1/admin/documents/financial-years', {
      preHandler: guards.anyUser,
      schema: { tags },
      handler: async () => createSuccessResponse(await service.listFinancialYears()),
    });

    fastify.post('/api/v1/admin/document-uploads', {
      preHandler: guards.canPublish,
      schema: { tags },
      handler: async (request, reply) => {
        reply.code(201);
        return createSuccessResponse(await service.createUploadSession(request.body, actor(request)));
      },
    });

    fastify.post('/api/v1/admin/documents', {
      preHandler: guards.canPublish,
      schema: { tags },
      handler: async (request, reply) => {
        reply.code(201);
        return createSuccessResponse(await service.createDocument(request.body, actor(request)));
      },
    });

    fastify.get('/api/v1/admin/documents/:id', {
      preHandler: guards.anyUser,
      schema: { tags, params: idParams },
      handler: async (request) => createSuccessResponse(await service.getDocument((request.params as { id: string }).id)),
    });

    fastify.patch('/api/v1/admin/documents/:id', {
      preHandler: guards.canPublish,
      schema: { tags, params: idParams },
      handler: async (request) => createSuccessResponse(await service.updateDocument((request.params as { id: string }).id, request.body, actor(request))),
    });

    for (const action of ['publish', 'unpublish', 'archive', 'restore'] as const) {
      fastify.post(`/api/v1/admin/documents/:id/${action}`, {
        preHandler: guards.canPublish,
        schema: { tags, params: idParams },
        handler: async (request) => createSuccessResponse(await service.changeStatus((request.params as { id: string }).id, action, actor(request))),
      });
    }

    fastify.post('/api/v1/admin/documents/:id/file', {
      preHandler: guards.canPublish,
      schema: { tags, params: idParams },
      handler: async (request) => createSuccessResponse(await service.replaceFile((request.params as { id: string }).id, request.body, actor(request))),
    });

    fastify.post('/api/v1/admin/documents/:id/versions/:versionId/restore', {
      preHandler: guards.canPublish,
      schema: { tags },
      handler: async (request) => {
        const { id, versionId } = request.params as { id: string; versionId: string };
        return createSuccessResponse(await service.restoreVersion(id, versionId, actor(request)));
      },
    });

    fastify.get('/api/v1/admin/documents/:id/file-url', {
      preHandler: guards.anyUser,
      schema: {
        tags,
        params: idParams,
        querystring: { type: 'object', properties: { versionId: { type: 'string' }, download: { type: 'boolean' } } },
      },
      handler: async (request) => {
        const query = request.query as { versionId?: string; download?: boolean };
        return createSuccessResponse(await service.getAdminFileUrl((request.params as { id: string }).id, query));
      },
    });

    fastify.get('/api/v1/admin/documents/:id/audit', {
      preHandler: guards.anyUser,
      schema: { tags, params: idParams },
      handler: async (request) => createSuccessResponse(await audit.list({ entityType: 'document', entityId: (request.params as { id: string }).id })),
    });

    fastify.delete('/api/v1/admin/documents/:id', {
      preHandler: guards.adminOnly,
      schema: { tags, params: idParams },
      handler: async (request) => createSuccessResponse(await service.deleteDocument((request.params as { id: string }).id, actor(request))),
    });

    fastify.get('/api/v1/admin/audit-logs', {
      preHandler: guards.adminOnly,
      schema: { tags, querystring: { type: 'object', properties: { entityType: { type: 'string' }, entityId: { type: 'string' }, limit: { type: 'number' } } } },
      handler: async (request) => createSuccessResponse(await audit.list(request.query as { entityType?: string; entityId?: string; limit?: number })),
    });
  };
}
