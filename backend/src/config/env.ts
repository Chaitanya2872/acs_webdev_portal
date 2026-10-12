import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  STORAGE_MODE: z.enum(['s3', 'memory']).default('s3'),
  PORT: z.coerce.number().int().positive().default(3000),
  AWS_REGION: z.string().default(''),
  AWS_ACCESS_KEY_ID: z.string().default(''),
  AWS_SECRET_ACCESS_KEY: z.string().default(''),
  S3_BUCKET_NAME: z.string().default(''),
  PRESIGNED_URL_EXPIRATION: z.coerce.number().int().positive().default(900),
  MAX_FILE_SIZE: z.coerce.number().int().positive().default(104857600),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
});

export const env = envSchema.parse(process.env);

export function validateRequiredAwsConfig() {
  const missing = [
    ['AWS_REGION', env.AWS_REGION],
    ['AWS_ACCESS_KEY_ID', env.AWS_ACCESS_KEY_ID],
    ['AWS_SECRET_ACCESS_KEY', env.AWS_SECRET_ACCESS_KEY],
    ['S3_BUCKET_NAME', env.S3_BUCKET_NAME],
  ]
    .filter(([, value]) => !value || !String(value).trim())
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Missing required AWS configuration: ${missing.join(', ')}`);
  }
}
