import { z } from 'zod';
import { AppError } from '../../utils/response';
import { isValidFinancialYear } from '../../utils/document-key';

const title = z.string().trim().min(1, 'Title is required').max(300, 'Title must be 300 characters or fewer');
const financialYear = z
  .string()
  .trim()
  .refine(isValidFinancialYear, 'Financial year must look like 2025-26')
  .nullable();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Document date must be YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value), 'Document date is not a valid date')
  .nullable();
const displayOrder = z.coerce.number().int().min(-100000).max(100000);
const placement = z.object({
  categoryId: z.coerce.number().int().positive(),
  titleOverride: z.string().trim().max(300).nullable().optional(),
  displayOrder: displayOrder.optional(),
});

export const createUploadSchema = z.object({
  fileName: z.string().trim().min(1, 'File name is required').max(255),
  fileSize: z.coerce.number().int().positive('The file is empty'),
  contentType: z.string().trim().toLowerCase(),
});

export const createDocumentSchema = z.object({
  uploadId: z.string().uuid('A valid upload id is required'),
  title,
  categoryId: z.coerce.number().int().positive('Select a category'),
  additionalPlacements: z.array(placement).max(10).default([]),
  displayFilename: z.string().trim().max(255).optional(),
  financialYear: financialYear.optional(),
  reportingPeriod: z.string().trim().max(100).nullable().optional(),
  documentDate: isoDate.optional(),
  displayOrder: displayOrder.default(0),
  publish: z.boolean().default(false),
});

export const updateDocumentSchema = z
  .object({
    title: title.optional(),
    categoryId: z.coerce.number().int().positive().optional(),
    additionalPlacements: z.array(placement).max(10).optional(),
    displayFilename: z.string().trim().min(1).max(255).optional(),
    financialYear: financialYear.optional(),
    reportingPeriod: z.string().trim().max(100).nullable().optional(),
    documentDate: isoDate.optional(),
    displayOrder: displayOrder.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'No changes were submitted');

export const replaceFileSchema = z.object({
  uploadId: z.string().uuid('A valid upload id is required'),
  keepDisplayFilename: z.boolean().default(true),
});

export const listDocumentsSchema = z.object({
  categoryId: z.coerce.number().int().positive().optional(),
  status: z.enum(['draft', 'published', 'unpublished', 'archived', 'active']).optional(),
  financialYear: z.string().trim().optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const publicListSchema = z.object({
  financialYear: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(500),
});

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;
export type ListDocumentsQuery = z.infer<typeof listDocumentsSchema>;

/** Parses input with zod and converts the first issue into a 400 AppError the API client can show as-is. */
export function parseInput<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path?.join('.');
    throw new AppError('VALIDATION_ERROR', issue ? `${issue.message}${field && !issue.message.toLowerCase().includes(field.toLowerCase()) ? ` (${field})` : ''}` : 'Invalid request.', 400);
  }
  return result.data;
}
