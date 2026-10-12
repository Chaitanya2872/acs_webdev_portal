export type CreateFileRequest = {
  folderName: string;
  fileName: string;
  contentType: string;
  fileSize: number;
};

export type UpdateFileRequest = {
  fileName?: string;
  contentType?: string;
  fileSize?: number;
};

export type FileListQuery = {
  folderName?: string;
  limit?: number;
  continuationToken?: string;
};
