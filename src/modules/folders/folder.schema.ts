import { z } from 'zod';

export const createFolderSchema = z.object({
  folderName: z.string().min(1, 'Folder name is required'),
});

export const folderParamsSchema = z.object({
  '*': z.string().min(1),
});
