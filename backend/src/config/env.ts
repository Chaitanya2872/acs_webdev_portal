import dotenv from 'dotenv';
import { z } from 'zod';

// Tests run with the isolated environment from vitest.config.mts, never with local credentials.
if (process.env.NODE_ENV !== 'test') {
  dotenv.config({ quiet: true });
}

const booleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((value) => (typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  STORAGE_MODE: z.enum(['s3', 'memory']).default('s3'),
  PORT: z.coerce.number().int().positive().default(3000),
  TRUST_PROXY: booleanFromString.default(false),
  AWS_REGION: z.string().default(''),
  // Optional: when both keys are empty the AWS SDK default provider chain (IAM role, profile, SSO) is used.
  AWS_ACCESS_KEY_ID: z.string().default(''),
  AWS_SECRET_ACCESS_KEY: z.string().default(''),
  S3_BUCKET_NAME: z.string().default(''),
  // Optional S3-compatible endpoint (e.g. a local emulator). Leave empty for AWS.
  S3_ENDPOINT: z.string().default(''),
  S3_FORCE_PATH_STYLE: booleanFromString.default(false),
  PRESIGNED_URL_EXPIRATION: z.coerce.number().int().positive().default(900),
  MAX_FILE_SIZE: z.coerce.number().int().positive().default(104857600),
  ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  // Website visitors can share an IP (offices, mobile carriers), so public reads get a higher per-minute limit.
  PUBLIC_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),

  // Database: postgres://… for PostgreSQL, or pglite:<dir> / pglite:memory for an embedded database (dev/tests).
  DATABASE_URL: z.string().default('pglite:./.data/pglite'),
  DB_AUTO_MIGRATE: booleanFromString.optional(),

  // Corporate document publishing
  S3_DOCUMENTS_PREFIX: z.string().default('corporate-documents'),
  MAX_PDF_FILE_SIZE: z.coerce.number().int().positive().default(52428800),
  PUBLIC_DOCUMENT_URL_TTL: z.coerce.number().int().positive().default(300),
  PUBLIC_LIST_CACHE_SECONDS: z.coerce.number().int().nonnegative().default(60),
  // Absolute origin of this API as seen by website visitors, e.g. https://portal-api.acstechnologies.co.in.
  PUBLIC_API_BASE_URL: z.string().default(''),
  // Optional CDN (e.g. CloudFront with origin access control) serving the documents prefix read-only.
  PUBLIC_CDN_BASE_URL: z.string().default(''),

  // Admin authentication (employee code + one-time password)
  AUTH_SECRET: z.string().default(''),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_DELIVERY: z.enum(['log', 'smtp']).default('log'),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: booleanFromString.default(false),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().default(''),

  // Fawnix Attend is the source of truth for employee OTP authentication.
  FAWNIX_ATTEND_BASE_URL: z.string().url().default(''),
});

export const env = envSchema.parse(process.env);

export const shouldAutoMigrate = env.DB_AUTO_MIGRATE ?? env.NODE_ENV !== 'production';

export function validateRequiredAwsConfig() {
  const missing = [
    ['AWS_REGION', env.AWS_REGION],
    ['S3_BUCKET_NAME', env.S3_BUCKET_NAME],
  ]
    .filter(([, value]) => !value || !String(value).trim())
    .map(([key]) => key);

  if (Boolean(env.AWS_ACCESS_KEY_ID) !== Boolean(env.AWS_SECRET_ACCESS_KEY)) {
    missing.push(env.AWS_ACCESS_KEY_ID ? 'AWS_SECRET_ACCESS_KEY' : 'AWS_ACCESS_KEY_ID');
  }

  if (missing.length > 0) {
    throw new Error(`Missing required AWS configuration: ${missing.join(', ')}`);
  }
}

export function validateProductionSecurityConfig() {
  if (env.NODE_ENV !== 'production') return;

  const problems: string[] = [];
  if (env.AUTH_SECRET.length < 32) problems.push('AUTH_SECRET must be at least 32 characters');
  if (!env.FAWNIX_ATTEND_BASE_URL) problems.push('FAWNIX_ATTEND_BASE_URL is required');
  if (env.OTP_DELIVERY === 'log') problems.push('OTP_DELIVERY=log is not allowed in production');
  if (env.DATABASE_URL.startsWith('pglite:')) problems.push('DATABASE_URL must point to PostgreSQL in production');
  if (env.STORAGE_MODE !== 's3') problems.push('STORAGE_MODE must be s3 in production');

  if (problems.length > 0) {
    throw new Error(`Invalid production configuration: ${problems.join('; ')}`);
  }
}
