
import { apiRequest } from "./apiClient";

const getEncodedKey = (key) =>
  String(key)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

const normalizeFile = (file = {}) => {
  const key = file.key || file.id || "";
  const fileName =
    file.fileName || file.name || key.split("/").pop() || "Untitled";

  return {
    ...file,
    id: key,
    key,
    name: fileName,
    fileName,
    type: file.contentType || file.type || "application/octet-stream",
    contentType: file.contentType || file.type || "application/octet-stream",
    size: Number(file.size || 0),
    uploadedAt: file.lastModified || file.uploadedAt || null,
    folderName: key.includes("/")
      ? key.substring(0, key.lastIndexOf("/"))
      : "",
  };
};

export async function listFiles(folderName) {
  const query = folderName
    ? `?folderName=${encodeURIComponent(folderName)}`
    : "";

  const data = await apiRequest(`/files${query}`);

  const files = Array.isArray(data) ? data : data?.files || [];

  return files.map(normalizeFile);
}

export async function getFile(key) {
  if (!key) {
    throw new Error("A file key is required.");
  }

  const data = await apiRequest(`/files/${getEncodedKey(key)}`);

  return {
    ...normalizeFile(data),
    downloadUrl: data?.downloadUrl,
    expiresIn: data?.expiresIn,
  };
}

export async function deleteFile(key) {
  if (!key) {
    throw new Error("A file key is required.");
  }

  return apiRequest(`/files/${getEncodedKey(key)}`, {
    method: "DELETE",
  });
}

export async function renameFile(key, fileName) {
  if (!key || !String(fileName || "").trim()) {
    throw new Error("A file key and new name are required.");
  }

  const data = await apiRequest(`/files/${getEncodedKey(key)}`, {
    method: "PUT",
    body: JSON.stringify({ fileName: String(fileName).trim() }),
  });
  return { ...normalizeFile(data), uploadUrl: data?.uploadUrl };
}

export async function requestUpload({
  folderName = "general",
  file,
}) {
  if (!(file instanceof File)) {
    throw new Error("Please select a valid file.");
  }

  const normalizedFolder = String(folderName || "general").trim();

  if (!normalizedFolder) {
    throw new Error("A folder name is required.");
  }

  // Request a presigned upload URL from the backend.
  const uploadRequest = await apiRequest("/files", {
    method: "POST",
    body: JSON.stringify({
      folderName: normalizedFolder,
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      fileSize: file.size,
    }),
  });

  if (!uploadRequest?.uploadUrl || !uploadRequest?.key) {
    throw new Error("The backend did not return a valid upload URL.");
  }

  // Upload the actual file directly to S3.
  // Do not send this request to the backend API client.
  let uploadResponse;

  try {
    uploadResponse = await fetch(uploadRequest.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    });
  } catch {
    throw new Error(
      "File upload failed. Check the S3 bucket CORS configuration and network connection."
    );
  }

  if (!uploadResponse.ok) {
    throw new Error(
      `S3 upload failed with status ${uploadResponse.status}.`
    );
  }

  return normalizeFile({
    key: uploadRequest.key,
    fileName: uploadRequest.fileName || file.name,
    contentType: file.type || "application/octet-stream",
    size: file.size,
    lastModified: new Date().toISOString(),
  });
}