import 'fastify';
import { S3Service } from '../services/s3.service';
import { AuthUser } from '../modules/auth/auth.service';

declare module 'fastify' {
  interface FastifyInstance {
    s3Service: S3Service;
  }

  interface FastifyRequest {
    user?: AuthUser;
  }
}
