import { defineConfig } from 'vitest/config';

// Tests never touch AWS or a shared database: storage is in memory and PostgreSQL is embedded (PGlite).
export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      STORAGE_MODE: 'memory',
      DATABASE_URL: 'pglite:memory',
      AWS_REGION: 'us-east-1',
      S3_BUCKET_NAME: 'test-bucket',
      S3_DOCUMENTS_PREFIX: 'corporate-documents',
      PUBLIC_API_BASE_URL: 'https://api.test',
      MAX_PDF_FILE_SIZE: '1048576',
      RATE_LIMIT_MAX: '100000',
      PUBLIC_RATE_LIMIT_MAX: '100000',
    },
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
