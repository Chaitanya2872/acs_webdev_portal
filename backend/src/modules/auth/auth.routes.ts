import { FastifyInstance } from 'fastify';
import { createSuccessResponse } from '../../utils/response';
import { AuthGuards, bearerToken } from './auth.guard';
import { AuthService } from './auth.service';

const userSchema = {
  type: 'object',
  properties: {
    id: { type: 'number' },
    employeeCode: { type: 'string' },
    name: { type: 'string' },
    email: { type: 'string', nullable: true },
    role: { type: 'string' },
  },
};

export function authRoutes(authService: AuthService, guards: AuthGuards) {
  return async function registerAuthRoutes(fastify: FastifyInstance) {
    const strictLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

    fastify.post('/api/v1/auth/otp/request', {
      config: strictLimit,
      schema: {
        tags: ['Auth'],
        body: {
          type: 'object',
          required: ['employeeCode'],
          properties: { employeeCode: { type: 'string', minLength: 2, maxLength: 64 } },
        },
      },
      handler: async (request) => {
        const { employeeCode } = request.body as { employeeCode: string };
        return createSuccessResponse(await authService.requestOtp(employeeCode, request.ip));
      },
    });

    fastify.post('/api/v1/auth/otp/verify', {
      config: strictLimit,
      schema: {
        tags: ['Auth'],
        body: {
          type: 'object',
          required: ['employeeCode', 'otp'],
          properties: {
            employeeCode: { type: 'string', minLength: 2, maxLength: 64 },
            otp: { type: 'string', minLength: 6, maxLength: 6 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object', properties: { token: { type: 'string' }, expiresAt: { type: 'string' }, user: userSchema } },
            },
          },
        },
      },
      handler: async (request) => {
        const { employeeCode, otp } = request.body as { employeeCode: string; otp: string };
        const session = await authService.verifyOtp(employeeCode, otp, { ip: request.ip, userAgent: request.headers['user-agent'] ?? null });
        return createSuccessResponse(session);
      },
    });

    fastify.get('/api/v1/auth/me', {
      preHandler: guards.anyUser,
      schema: {
        tags: ['Auth'],
        response: { 200: { type: 'object', properties: { success: { type: 'boolean' }, data: userSchema } } },
      },
      handler: async (request) => createSuccessResponse(request.user),
    });

    fastify.post('/api/v1/auth/logout', {
      preHandler: guards.anyUser,
      schema: { tags: ['Auth'] },
      handler: async (request) => {
        await authService.logout(bearerToken(request) ?? '', request.user!, request.ip);
        return createSuccessResponse({ loggedOut: true });
      },
    });
  };
}
