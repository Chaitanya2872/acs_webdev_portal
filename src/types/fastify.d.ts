import 'fastify';
import { S3Service } from '../services/s3.service';

declare module 'fastify' {
  interface FastifyInstance {
    s3Service: S3Service;
  }
}
