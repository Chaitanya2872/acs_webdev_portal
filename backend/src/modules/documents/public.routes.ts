import { FastifyInstance, FastifyRequest } from 'fastify';
import { env } from '../../config/env';
import { createSuccessResponse } from '../../utils/response';
import { PublicDocumentService } from './public-document.service';

/** Origin used to build absolute document URLs for the website. */
export const publicBaseUrl = (request: FastifyRequest) =>
  (env.PUBLIC_API_BASE_URL || `${request.protocol}://${request.host}`).replace(/\/+$/, '');

/**
 * Read-only API consumed by the corporate website. Exposes published documents only; no authentication,
 * CORS open to any origin (see app.ts), short public cache lifetimes so new publications show up quickly.
 */
export function publicDocumentRoutes(service: PublicDocumentService) {
  return async function registerPublicDocumentRoutes(fastify: FastifyInstance) {
    const tags = ['Documents (public)'];
    const config = { rateLimit: { max: env.PUBLIC_RATE_LIMIT_MAX, timeWindow: '1 minute' } };
    // Browsers always refetch listings so a publish/unpublish shows on the next page view; only a shared
    // cache (CDN/proxy) in front of the API may reuse a listing, for at most PUBLIC_LIST_CACHE_SECONDS.
    const listCacheHeader = env.PUBLIC_LIST_CACHE_SECONDS > 0 ? `public, max-age=0, s-maxage=${env.PUBLIC_LIST_CACHE_SECONDS}` : 'no-cache';

    fastify.get('/api/v1/public/sections', {
      config,
      schema: { tags },
      handler: async (_request, reply) => {
        reply.header('Cache-Control', listCacheHeader);
        return createSuccessResponse(await service.listSections());
      },
    });

    fastify.get('/api/v1/public/sections/:slug/documents', {
      config,
      schema: {
        tags,
        params: { type: 'object', required: ['slug'], properties: { slug: { type: 'string', pattern: '^[a-z0-9-]{1,100}$' } } },
      },
      handler: async (request, reply) => {
        const { slug } = request.params as { slug: string };
        const result = await service.listSectionDocuments(slug, request.query, publicBaseUrl(request));
        reply.header('Cache-Control', listCacheHeader);
        return createSuccessResponse(result);
      },
    });

    // Redirects to a short-lived presigned S3 URL. The redirect itself is never cached, so unpublishing or
    // replacing a document takes effect on the next click.
    fastify.get('/api/v1/public/documents/:id/file', {
      config,
      schema: { tags, params: { type: 'object', required: ['id'], properties: { id: { type: 'string', maxLength: 64 } } } },
      handler: async (request, reply) => {
        const { id } = request.params as { id: string };
        const { download } = request.query as { download?: string };
        const url = await service.resolveFileUrl(id, download === '1' || download === 'true');
        reply.header('Cache-Control', 'no-store');
        return reply.redirect(url, 302);
      },
    });

    // Compatibility for old /assets/docs/... links once the original files are retired from the web server.
    fastify.get('/api/v1/public/legacy-documents', {
      config,
      schema: { tags, querystring: { type: 'object', required: ['path'], properties: { path: { type: 'string', maxLength: 600 }, format: { type: 'string' } } } },
      handler: async (request, reply) => {
        const { path, format } = request.query as { path: string; format?: string };
        const result = await service.resolveLegacyPath(path, publicBaseUrl(request));
        reply.header('Cache-Control', listCacheHeader);
        if (format === 'json') return createSuccessResponse(result);
        return reply.redirect(result.url, 302);
      },
    });
  };
}
