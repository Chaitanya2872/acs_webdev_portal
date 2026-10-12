import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, createErrorResponse } from '../utils/response';

export default async function errorHandler(fastify: { setErrorHandler: (handler: (error: FastifyError | AppError, _request: FastifyRequest, reply: FastifyReply) => unknown) => void }) {
  fastify.setErrorHandler((error: FastifyError | AppError, _request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send(createErrorResponse(error.code, error.message));
    }

    if ((error as { validation?: unknown }).validation) {
      return reply.code(400).send(createErrorResponse('INVALID_REQUEST', 'Request validation failed.'));
    }

    const statusCode = typeof (error as { statusCode?: number }).statusCode === 'number' ? (error as { statusCode: number }).statusCode : 500;
    const code = statusCode === 404 ? 'FILE_NOT_FOUND' : 'INTERNAL_SERVER_ERROR';
    const message = statusCode === 404 ? 'The requested resource was not found.' : 'An internal server error occurred.';
    return reply.code(statusCode).send(createErrorResponse(code, message));
  });
}
