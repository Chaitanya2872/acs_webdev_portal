import { z } from 'zod';

export const createFileSchema = z.object({
  folderName: z.string().min(1, 'Folder name is required'),
  fileName: z.string().min(1, 'File name is required'),
  contentType: z.string().min(1, 'Content type is required'),
  fileSize: z.number().int().nonnegative(),
});

export const updateFileSchema = z.object({
  fileName: z.string().optional(),
  contentType: z.string().optional(),
  fileSize: z.number().int().nonnegative().optional(),
});

export const listFilesQuerySchema = z.object({
  folderName: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  continuationToken: z.string().optional(),
});
