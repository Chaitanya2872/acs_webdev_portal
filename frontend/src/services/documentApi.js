import { apiRequest } from "./apiClient";

// Website documents: PDFs published to the corporate website.

const toQuery = (params = {}) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  });
  const text = query.toString();
  return text ? `?${text}` : "";
};

export const listCategories = () => apiRequest("/admin/document-categories");

export const listDocuments = (params) => apiRequest(`/admin/documents${toQuery(params)}`);

export const listFinancialYears = () => apiRequest("/admin/documents/financial-years");

export const getDocument = (id) => apiRequest(`/admin/documents/${id}`);

export const getDocumentAudit = (id) => apiRequest(`/admin/documents/${id}/audit`);

export const createDocument = (payload) =>
  apiRequest("/admin/documents", { method: "POST", body: JSON.stringify(payload) });

export const updateDocument = (id, payload) =>
  apiRequest(`/admin/documents/${id}`, { method: "PATCH", body: JSON.stringify(payload) });

/** action: publish | unpublish | archive | restore */
export const changeDocumentStatus = (id, action) =>
  apiRequest(`/admin/documents/${id}/${action}`, { method: "POST" });

export const replaceDocumentFile = (id, uploadId, keepDisplayFilename = true) =>
  apiRequest(`/admin/documents/${id}/file`, { method: "POST", body: JSON.stringify({ uploadId, keepDisplayFilename }) });

export const restoreDocumentVersion = (id, versionId) =>
  apiRequest(`/admin/documents/${id}/versions/${versionId}/restore`, { method: "POST" });

export const deleteDocument = (id) => apiRequest(`/admin/documents/${id}`, { method: "DELETE" });

export const getDocumentFileUrl = (id, { versionId, download } = {}) =>
  apiRequest(`/admin/documents/${id}/file-url${toQuery({ versionId, download: download ? "true" : undefined })}`);

/** Quick client-side check so obviously wrong files are rejected before uploading; the server re-validates. */
export async function checkPdfFile(file) {
  if (!(file instanceof File)) return "Choose a PDF file.";
  if (!file.name.toLowerCase().endsWith(".pdf")) return "Only PDF files can be uploaded.";
  if (file.size === 0) return "The selected file is empty.";
  const head = await file.slice(0, 1024).text();
  if (!head.includes("%PDF-")) return "This file is not a valid PDF.";
  return "";
}

/**
 * Uploads a PDF straight to S3 through a presigned URL and returns the upload id to attach to a document.
 * onProgress receives 0–100.
 */
export async function uploadPdf(file, onProgress) {
  const session = await apiRequest("/admin/document-uploads", {
    method: "POST",
    body: JSON.stringify({ fileName: file.name, fileSize: file.size, contentType: "application/pdf" }),
  });

  await new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(session.method || "PUT", session.uploadUrl);
    Object.entries(session.headers || { "Content-Type": "application/pdf" }).forEach(([name, value]) => request.setRequestHeader(name, value));
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(new Error(`Upload to storage failed (status ${request.status}). Try again.`));
    request.onerror = () => reject(new Error("Upload to storage failed. Check your connection and the bucket CORS settings."));
    request.onabort = () => reject(new Error("The upload was cancelled."));
    request.send(file);
  });

  onProgress?.(100);
  return session.uploadId;
}
