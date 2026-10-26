import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, createErrorResponse } from '../utils/response';

export default async function errorHandler(fastify: { setErrorHandler: (handler: (error: FastifyError | AppError, request: FastifyRequest, reply: FastifyReply) => unknown) => void }) {
  fastify.setErrorHandler((error: FastifyError | AppError, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof AppError) {
      if (error.statusCode >= 500) request.log.error({ err: error }, error.message);
      return reply.code(error.statusCode).send(createErrorResponse(error.code, error.message));
    }

    if ((error as { validation?: unknown }).validation) {
      return reply.code(400).send(createErrorResponse('INVALID_REQUEST', 'Request validation failed.'));
    }

    const statusCode = typeof (error as { statusCode?: number }).statusCode === 'number' ? (error as { statusCode: number }).statusCode : 500;
    if (statusCode === 404) {
      return reply.code(404).send(createErrorResponse('FILE_NOT_FOUND', 'The requested resource was not found.'));
    }
    if (statusCode === 429) {
      return reply.code(429).send(createErrorResponse('RATE_LIMITED', 'Too many requests. Please wait and try again.'));
    }
    if (statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send(createErrorResponse('INVALID_REQUEST', 'The request could not be processed.'));
    }

    request.log.error({ err: error }, 'Unhandled error');
    return reply.code(statusCode).send(createErrorResponse('INTERNAL_SERVER_ERROR', 'An internal server error occurred.'));
  });
}
