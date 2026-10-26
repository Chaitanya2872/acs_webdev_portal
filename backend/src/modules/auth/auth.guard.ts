import { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../../utils/response';
import { AuthService, Role } from './auth.service';
import { AuditActor } from '../audit/audit.service';

export const bearerToken = (request: FastifyRequest): string | null => {
  const header = request.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
};

/** preHandler factories: requireRole() alone means "any signed-in user". */
export function createAuthGuards(authService: AuthService) {
  const requireRole = (...roles: Role[]) =>
    async function authGuard(request: FastifyRequest, _reply: FastifyReply) {
      const token = bearerToken(request);
      const user = token ? await authService.authenticate(token) : null;
      if (!user) {
        throw new AppError('UNAUTHORIZED', 'Sign in to continue.', 401);
      }
      if (roles.length > 0 && !roles.includes(user.role)) {
        throw new AppError('FORBIDDEN', 'You do not have permission to perform this action.', 403);
      }
      request.user = user;
    };

  return {
    requireRole,
    /** Upload, edit, publish, unpublish, archive, replace. */
    canPublish: requireRole('admin', 'publisher'),
    /** Permanent deletion and other destructive operations. */
    adminOnly: requireRole('admin'),
    /** Read access to the portal. */
    anyUser: requireRole(),
  };
}

export type AuthGuards = ReturnType<typeof createAuthGuards>;

export const actorFromRequest = (request: FastifyRequest): AuditActor => ({
  id: request.user?.id ?? null,
  label: request.user?.employeeCode ?? 'anonymous',
  ip: request.ip,
});
