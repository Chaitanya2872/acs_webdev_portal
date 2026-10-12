import React, { useRef, useState } from "react";
import {
  Zap,
  Upload,
  FolderPlus,
  Loader2,
} from "lucide-react";

import "./index.css";
import { saveFileContent } from "../../utils/fileStorage";
import { useToast } from "../../../components/common/Toast";

const QuickActions = ({ onAction, onFilesUploaded, onFolderCreated }) => {
  const notify = useToast();
  const fileInputRef = useRef(null);

  const [uploading, setUploading] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);

  /*
   * ---------------------------------------------------------
   * OPEN FILE PICKER
   * ---------------------------------------------------------
   */
  const handleUploadClick = () => {
    if (uploading) {
      return;
    }

    fileInputRef.current?.click();
  };

  /*
   * ---------------------------------------------------------
   * HANDLE FILE SELECTION
   *
   * Files and preview content are stored in localStorage.
   * ---------------------------------------------------------
   */
  const handleFilesSelected = async (event) => {
    const selectedFiles = Array.from(
      event.target.files || []
    );

    if (selectedFiles.length === 0) {
      return;
    }

    setUploading(true);

    try {
      const existingFiles = JSON.parse(
        localStorage.getItem("fawnix_files") || "[]"
      );

      const newFiles = await Promise.all(selectedFiles.map(async (file) => {
        const id = `file-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        await saveFileContent(id, file);
        return {
          name: file.name, size: file.size, type: file.type || "application/octet-stream",
          lastModified: file.lastModified, uploadedAt: new Date().toISOString(),
          id,
          owner: { name: localStorage.getItem("fawnix_user_name") || "Sanjay" },
        };
      }));

      const updatedFiles = [
        ...newFiles,
        ...existingFiles,
      ];

      localStorage.setItem(
        "fawnix_files",
        JSON.stringify(updatedFiles)
      );

      /*
       * Tell parent/dashboard that files changed.
       */
      onFilesUploaded?.(newFiles);

      onAction?.("upload", newFiles);
    } catch (error) {
      console.error("File upload error:", error);

      notify(error.message || "Unable to add the selected files.", "error");
    } finally {
      setUploading(false);

      /*
       * Reset input so selecting the same file again
       * triggers onChange.
       */
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  /*
   * ---------------------------------------------------------
   * CREATE NEW FOLDER
   *
   * Frontend-only for now.
   * ---------------------------------------------------------
   */
  const handleNewFolder = () => {
    if (creatingFolder) {
      return;
    }

    const folderName = window.prompt(
      "Enter folder name:"
    );

    if (!folderName) {
      return;
    }

    const trimmedName = folderName.trim();

    if (!trimmedName) {
      return;
    }

    setCreatingFolder(true);

    try {
      const existingFolders = JSON.parse(
        localStorage.getItem("fawnix_folders") || "[]"
      );

      const folder = {
        id: `folder-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 9)}`,

        name: trimmedName,

        createdAt: new Date().toISOString(),

        owner:
          localStorage.getItem("fawnix_user_name") ||
          "Sanjay",
      };

      const updatedFolders = [
        folder,
        ...existingFolders,
      ];

      localStorage.setItem(
        "fawnix_folders",
        JSON.stringify(updatedFolders)
      );

      onFolderCreated?.(folder);

      onAction?.("new-folder", folder);
    } catch (error) {
      console.error("Folder creation error:", error);

      notify(error.message || "Unable to create the folder.", "error");
    } finally {
      setCreatingFolder(false);
    }
  };

  return (
    <section className="quick-actions-card">
      <div className="quick-actions-title">
        <Zap size={20} />
        <h2>Quick Actions</h2>
      </div>

      {/* Hidden native file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={handleFilesSelected}
      />

      <button
        type="button"
        className="quick-upload-button"
        onClick={handleUploadClick}
        disabled={uploading || creatingFolder}
      >
        {uploading ? (
          <Loader2
            size={16}
            className="quick-action-spinner"
          />
        ) : (
          <Upload size={16} />
        )}

        {uploading
          ? "Uploading..."
          : "Upload Files"}
      </button>

      <button
        type="button"
        className="quick-folder-button"
        onClick={handleNewFolder}
        disabled={uploading || creatingFolder}
      >
        {creatingFolder ? (
          <Loader2
            size={17}
            className="quick-action-spinner"
          />
        ) : (
          <FolderPlus size={17} />
        )}

        {creatingFolder
          ? "Creating..."
          : "New Folder"}
      </button>
    </section>
  );
};

export default QuickActions;
