
import { listFiles } from "./fileApi";

export async function getStorageSummary() {
  const files = await listFiles();

  const usedBytes = files.reduce(
    (total, file) => total + Number(file.size || 0),
    0
  );

  return {
    files,
    fileCount: files.length,
    usedBytes,
    usedMB: usedBytes / (1024 * 1024),
    usedGB: usedBytes / (1024 * 1024 * 1024),
  };
}