
import { requestUpload } from "./fileApi";

export async function uploadFiles(
  files,
  folderName = "general",
  onProgress
) {
  const selectedFiles = Array.from(files || []);

  if (selectedFiles.length === 0) {
    return [];
  }

  const uploadedFiles = [];
  const failedFiles = [];

  for (let index = 0; index < selectedFiles.length; index += 1) {
    const file = selectedFiles[index];

    try {
      const uploadedFile = await requestUpload({
        folderName,
        file,
      });

      uploadedFiles.push(uploadedFile);
    } catch (error) {
      failedFiles.push({
        fileName: file.name,
        message: error.message || "Upload failed.",
      });
    }

    if (typeof onProgress === "function") {
      onProgress(index + 1, selectedFiles.length, {
        fileName: file.name,
        successful: uploadedFiles.length,
        failed: failedFiles.length,
      });
    }
  }

  if (failedFiles.length > 0) {
    const summary = `${uploadedFiles.length} of ${selectedFiles.length} files uploaded successfully.`;
    const reasons = failedFiles
      .map(({ fileName, message }) => `${fileName}: ${message}`)
      .join(" ");
    const error = new Error(`${summary} ${reasons}`);

    error.uploadedFiles = uploadedFiles;
    error.failedFiles = failedFiles;

    throw error;
  }

  return uploadedFiles;
}