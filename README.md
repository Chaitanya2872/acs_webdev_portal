# S3 File API

A Fastify-based backend for managing folders and files in an Amazon S3 bucket. The project is designed for a React frontend and uses presigned URLs so the browser uploads and downloads files directly to S3 without routing large binary payloads through Node.js.

## Project overview

- Folder endpoints: create and list folders, and list files inside a folder
- File endpoints: create upload URLs, list files, fetch metadata, generate download URLs, replace/rename files, and delete files
- Storage: S3 is the only source of truth
- Authentication: intentionally out of scope for v1
- Validation: strict request validation and S3-key sanitization
- Logging: structured Fastify/Pino logs
- Docs: Swagger UI at `/docs`

## Architecture

React frontend -> Fastify API -> S3Service -> Amazon S3

## Prerequisites

- Node.js 20+
- npm
- An AWS account with access to an S3 bucket
- A bucket with public access blocked

## Installation

```bash
npm install
cp .env.example .env
```

Then fill in the required values in `.env`:

```bash
NODE_ENV=development
PORT=3000
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET_NAME=my-app-bucket
PRESIGNED_URL_EXPIRATION=900
MAX_FILE_SIZE=104857600
ALLOWED_ORIGINS=http://localhost:5173
```

## AWS setup

Create an S3 bucket in your target region. Keep the bucket private and enable Block Public Access.

Example bucket-scoped IAM policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BucketScopedS3Access",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket",
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:HeadObject",
        "s3:CopyObject"
      ],
      "Resource": [
        "arn:aws:s3:::my-app-bucket",
        "arn:aws:s3:::my-app-bucket/*"
      ]
    }
  ]
}
```

Use least privilege. Do not grant `AmazonS3FullAccess` unless you explicitly must and understand the risk.

### Configure CORS for browser uploads

There are two separate browser-to-server connections:

- React to this API: set `ALLOWED_ORIGINS` in the backend `.env` to the exact React origin, including scheme and port. Multiple origins can be comma-separated, for example `http://localhost:5173,https://app.example.com`.
- React to S3: configure CORS on the S3 bucket. The backend returns a presigned URL, and the browser uploads the file directly to S3, so backend CORS settings do not apply to that upload request.

In the bucket's **Permissions → Cross-origin resource sharing (CORS)** settings, use a configuration like this, replacing the origin with the exact origin of your React app:

```json
[
  {
    "AllowedOrigins": ["http://localhost:5173"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

Keep the bucket private; CORS does not make objects public. The `Content-Type` sent by the browser when using the presigned upload URL must match the content type used to request that URL.

## Local development

```bash
npm run dev
```

The app listens on port 3000 by default.

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run test
npm run lint
npm run typecheck
```

## Swagger documentation

Open:

```bash
http://localhost:3000/docs
```

## Health endpoints

```bash
curl http://localhost:3000/health
curl http://localhost:3000/health/ready
```

## API examples

### Create folder

```bash
curl -X POST http://localhost:3000/api/v1/folders \
  -H 'Content-Type: application/json' \
  -d '{"folderName":"documents"}'
```

### List folders

```bash
curl http://localhost:3000/api/v1/folders
```

### Folder contents

```bash
curl http://localhost:3000/api/v1/folders/documents
```

### Request upload URL

```bash
curl -X POST http://localhost:3000/api/v1/files \
  -H 'Content-Type: application/json' \
  -d '{
    "folderName":"documents",
    "fileName":"report.pdf",
    "contentType":"application/pdf",
    "fileSize":5242880
  }'
```

### Upload file to S3

```ts
const response = await fetch(`${API_URL}/api/v1/files`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    folderName: 'documents',
    fileName: file.name,
    contentType: file.type,
    fileSize: file.size,
  }),
});

const result = await response.json();

await fetch(result.data.uploadUrl, {
  method: 'PUT',
  headers: { 'Content-Type': file.type },
  body: file,
});
```

### List files

```bash
curl "http://localhost:3000/api/v1/files?folderName=documents"
```

### Get file metadata and download URL

```bash
curl http://localhost:3000/api/v1/files/documents/report.pdf
```

### Replace a file

```bash
curl -X PUT http://localhost:3000/api/v1/files/documents/report.pdf \
  -H 'Content-Type: application/json' \
  -d '{
    "fileName":"final-report.pdf",
    "contentType":"application/pdf",
    "fileSize":6000000
  }'
```

### Delete a file

```bash
curl -X DELETE http://localhost:3000/api/v1/files/documents/report.pdf
```

## Upload flow

1. React sends a JSON payload to `POST /api/v1/files`
2. Backend validates folder, filename, type, and size
3. Backend checks for duplicates
4. Backend creates a presigned PUT URL for direct S3 upload
5. React uploads the file to S3 using the signed URL
6. React refreshes the file list

## Download flow

1. React calls `GET /api/v1/files/<key>`
2. Backend verifies the object exists
3. Backend returns a signed GET URL
4. Browser downloads the file directly from S3

## File replacement flow

1. The backend resolves the current object key
2. If the name changes, it copies the old object to the new key
3. It deletes the original object only after the copy succeeds
4. It returns a new presigned upload URL for the new file version

## Docker

```bash
docker build -t s3-file-api .
docker run --rm -p 3000:3000 --env-file .env s3-file-api
```

## Testing

```bash
npm test
```

The project includes mocked S3 unit tests, and the real S3 integration path requires valid AWS credentials and a real bucket.

## Production deployment

- Set `NODE_ENV=production`
- Use real AWS credentials from a secure secret manager or environment injection
- Keep `ALLOWED_ORIGINS` restricted to the actual frontend domain
- Keep an S3 bucket policy with private access only
- Use a load balancer, reverse proxy, or container orchestration platform to expose the API

## Troubleshooting

- If startup fails with missing AWS config, fill in `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `S3_BUCKET_NAME` in `.env`
- If requests fail with `UNSUPPORTED_FILE_TYPE`, ensure the content type is one of the allowed values
- If requests fail with `FILE_TOO_LARGE`, verify `MAX_FILE_SIZE` and the file size being transmitted
- If `403` or `AccessDenied` occurs, validate bucket permissions and object keys
- If an API request to the backend fails CORS, ensure the browser's exact frontend origin is listed in `ALLOWED_ORIGINS`
- If the API request succeeds but the browser's upload or download request to the S3 URL fails CORS, configure CORS on the S3 bucket for that frontend origin and method

## Important notes

- The backend never stores uploaded files on its local filesystem
- Only presigned URLs are used for upload and download
- S3 is the source of truth
- The project avoids auth middleware and database usage as requested for v1

## Final structure

```text
src/
  app.ts
  server.ts
  config/
    aws.ts
    env.ts
  middleware/
    error-handler.ts
  modules/
    files/
      file.controller.ts
      file.routes.ts
      file.schema.ts
      file.service.ts
      file.types.ts
    folders/
      folder.controller.ts
      folder.routes.ts
      folder.schema.ts
      folder.service.ts
      folder.types.ts
  services/
    s3.service.ts
  types/
    fastify.d.ts
  utils/
    filename.ts
    response.ts
    s3-key.ts
  tests/
    files/
    folders/
    s3/
```
