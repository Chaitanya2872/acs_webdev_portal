const DATABASE_NAME = "fawnix-file-content";
const STORE_NAME = "files";

const openDatabase = () => new Promise((resolve, reject) => {
  if (!globalThis.indexedDB) {
    reject(new Error("This browser does not support local file storage."));
    return;
  }
  const request = indexedDB.open(DATABASE_NAME, 1);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error("Unable to open file storage."));
});

export const saveFileContent = async (id, blob) => {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(blob, String(id));
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { const error = transaction.error; database.close(); reject(error || new Error("Unable to save file content.")); };
    transaction.onabort = () => { const error = transaction.error; database.close(); reject(error || new Error("File storage quota was exceeded.")); };
  });
};

export const getFileContent = async (id) => {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(String(id));
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("Unable to read file content."));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => { const error = transaction.error; database.close(); reject(error || new Error("Unable to read file content.")); };
  });
};

export const removeFileContent = async (id) => {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(String(id));
    transaction.oncomplete = () => { database.close(); resolve(); };
    transaction.onerror = () => { const error = transaction.error; database.close(); reject(error || new Error("Unable to remove file content.")); };
  });
};

export const openStoredFile = async (file) => {
  const tab = window.open("about:blank", "_blank");
  if (!tab) throw new Error("Allow pop-ups to preview this file.");
  try {
    const blob = file.dataUrl
      ? await (await fetch(file.dataUrl)).blob()
      : await getFileContent(file.id);
    if (!blob && (file.contentUrl || file.url)) {
      tab.location.href = file.contentUrl || file.url;
      return;
    }
    if (!blob) {
      tab.close();
      throw new Error(`The content for “${file.name}” is not stored in this browser. Please upload this file again to enable preview.`);
    }
    const previewBlob = blob.type ? blob : new Blob([blob], { type: file.type || "application/octet-stream" });
    const objectUrl = URL.createObjectURL(previewBlob);
    const extension = String(file.name || "").split(".").pop().toLowerCase();
    const inlineTypes = new Set(["pdf", "png", "jpg", "jpeg", "gif", "webp", "svg", "txt", "html", "htm"]);
    if (inlineTypes.has(extension)) {
      tab.location.href = objectUrl;
    } else {
      const link = tab.document.createElement("a");
      link.href = objectUrl;
      link.download = file.name || "download";
      link.textContent = `Open or download ${file.name || "file"}`;
      link.style.cssText = "font:16px system-ui;margin:40px;color:#075449";
      tab.document.body.append(link);
      link.click();
    }
  } catch (error) {
    tab.close();
    throw error;
  }
};
