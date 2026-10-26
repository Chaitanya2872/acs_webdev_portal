import { S3Client } from '@aws-sdk/client-s3';
import { env } from './env';

export const allowedOrigins = env.ALLOWED_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Static keys are optional: without them the SDK falls back to its default chain (IAM role, profile, SSO).
export const s3Client = new S3Client({
  region: env.AWS_REGION || 'us-east-1',
  ...(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
    ? { credentials: { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY } }
    : {}),
  ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
});
