
import { apiRequest } from "./apiClient";

const normalizeFolder = (folder = {}) => {
  const folderName =
    typeof folder === "string"
      ? folder
      : folder.folderName || folder.name || "";

  return {
    ...(typeof folder === "object" ? folder : {}),
    id: folderName,
    name: folderName.split("/").pop() || folderName,
    folderName,
    createdAt: folder.createdAt || folder.lastModified || null,
    owner: folder.owner || "You",
  };
};

const encodeFolderPath = (folderName) =>
  String(folderName)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

export async function listFolders() {
  const data = await apiRequest("/folders");

  const folders = Array.isArray(data)
    ? data
    : data?.folders || [];

  return folders.map(normalizeFolder);
}

export async function createFolder(folderName) {
  const name = String(folderName || "").trim();

  if (!name) {
    throw new Error("Please enter a folder name.");
  }

  const data = await apiRequest("/folders", {
    method: "POST",
    body: JSON.stringify({
      folderName: name,
    }),
  });

  return normalizeFolder(data);
}

export async function renameFolder(folderName, newName) {
  const path = String(folderName || "").trim();
  const name = String(newName || "").trim();
  if (!path || !name) throw new Error("A folder path and new name are required.");

  const data = await apiRequest(`/folders/${encodeFolderPath(path)}`, {
    method: "PUT",
    body: JSON.stringify({ newName: name }),
  });
  return normalizeFolder(data);
}

export async function deleteFolder(folderName) {
  const path = String(folderName || "").trim();
  if (!path) throw new Error("A folder path is required.");

  return apiRequest(`/folders/${encodeFolderPath(path)}`, { method: "DELETE" });
}

export async function getFolderContents(folderName) {
  const name = String(folderName || "").trim();

  if (!name) {
    throw new Error("A folder name is required.");
  }

  const data = await apiRequest(
    `/folders/${encodeFolderPath(name)}`
  );

  const files = Array.isArray(data?.files)
    ? data.files
    : [];
  const folders = Array.isArray(data?.folders)
    ? data.folders.map(normalizeFolder)
    : [];

  return {
    ...normalizeFolder(data),
    folderName: data?.folderName || name,
    folders,
    files: files.map((file) => {
      const key = file.key || "";

      return {
        ...file,
        id: key,
        key,
        name: file.fileName || key.split("/").pop(),
        fileName: file.fileName || key.split("/").pop(),
        type: file.contentType || "application/octet-stream",
        contentType: file.contentType || "application/octet-stream",
        uploadedAt: file.lastModified || null,
        size: Number(file.size || 0),
      };
    }),
  };
}