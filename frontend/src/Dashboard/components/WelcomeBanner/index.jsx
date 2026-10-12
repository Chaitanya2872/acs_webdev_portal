import React, {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  FileUp,
  Folder,
  FolderPlus,
  Loader2,
  X,
} from "lucide-react";

import "./index.css";
import { createFolder } from "../../../services/folderApi";
import { uploadFiles } from "../../../services/uploadApi";
import { useToast } from "../../../components/common/Toast";

const getCurrentUserName = () => {
  try {
    const savedName = localStorage.getItem("fawnix_user_name");
    if (savedName?.trim()) return savedName.trim();
    const savedUser = JSON.parse(localStorage.getItem("fawnix_user") || "null");
    const name = savedUser?.name || savedUser?.displayName || savedUser?.fullName;
    return name ? String(name).trim() : "there";
  } catch {
    return "there";
  }
};

/* ---------------------------------------------------------
   COMPONENT
   --------------------------------------------------------- */

const WelcomeBanner = ({
  user,
  onUpload,
  onFolderCreated,
  onFilesUploaded,
}) => {
  const notify = useToast();
  const fileInputRef = useRef(null);

  const [userName, setUserName] =
    useState(getCurrentUserName);

  const [uploading, setUploading] =
    useState(false);

  const [creatingFolder, setCreatingFolder] =
    useState(false);

  const [showFolderDialog, setShowFolderDialog] =
    useState(false);

  const [folderName, setFolderName] =
    useState("");

  const [folderConfirmed, setFolderConfirmed] =
    useState(false);

  /* ---------------------------------------------------------
     USER
     --------------------------------------------------------- */

  useEffect(() => {
    try {
      if (
        user &&
        typeof user === "object" &&
        user.name
      ) {
        setUserName(
          String(user.name)
        );
        return;
      }

      setUserName(getCurrentUserName());
    } catch (error) {
      console.error(
        "Unable to load user name:",
        error
      );
    }
  }, [user]);

  /* ---------------------------------------------------------
     FILE PICKER
     --------------------------------------------------------- */

  const openFilePicker = () => {
    if (
      uploading ||
      creatingFolder
    ) {
      return;
    }

    fileInputRef.current?.click();
  };

  /* ---------------------------------------------------------
     FILE UPLOAD
     --------------------------------------------------------- */

  const handleUpload = async (
    event
  ) => {
    const selectedFiles =
      Array.from(
        event?.target?.files || []
      );

    if (
      selectedFiles.length === 0
    ) {
      return;
    }

    setUploading(true);

    try {
      const newFiles = await uploadFiles(selectedFiles, "general");

      await onFilesUploaded?.(newFiles);

      onUpload?.(
        newFiles
      );
    } catch (error) {
      console.error(
        "Upload error:",
        error
      );

      notify(error.message || "Unable to upload the selected files.", "error");
    } finally {
      setUploading(false);

      if (
        fileInputRef.current
      ) {
        fileInputRef.current.value =
          "";
      }
    }
  };

  /* ---------------------------------------------------------
     OPEN FOLDER DIALOG
     --------------------------------------------------------- */

  const openFolderDialog = () => {
    if (
      creatingFolder ||
      uploading
    ) {
      return;
    }

    setFolderName("");
    setFolderConfirmed(false);
    setShowFolderDialog(true);
  };

  /* ---------------------------------------------------------
     CLOSE FOLDER DIALOG
     --------------------------------------------------------- */

  const closeFolderDialog = () => {
    if (creatingFolder) {
      return;
    }

    setShowFolderDialog(false);
    setFolderName("");
    setFolderConfirmed(false);
  };

  /* ---------------------------------------------------------
     CREATE FOLDER
     --------------------------------------------------------- */

  const handleCreateFolder = async () => {
    const trimmedName =
      String(folderName || "").trim();

    if (!trimmedName) {
      notify("Please enter a folder name.", "error");
      return;
    }

    if (!folderConfirmed) {
      notify("Please confirm the checkbox before creating the folder.", "error");
      return;
    }

    setCreatingFolder(true);

    try {
      const folder = await createFolder(trimmedName);

      await onFolderCreated?.(folder);
      notify(`Folder “${folder.name}” created.`, "success");

      setShowFolderDialog(false);
      setFolderName("");
      setFolderConfirmed(false);
    } catch (error) {
      console.error(
        "Folder creation error:",
        error
      );

      notify(error.message || "Unable to create the folder.", "error");
    } finally {
      setCreatingFolder(false);
    }
  };

  /* ---------------------------------------------------------
     TIME-BASED GREETING
     --------------------------------------------------------- */

  const getGreeting = () => {
    const hour =
      new Date().getHours();

    if (hour < 12) {
      return "Good Morning";
    }

    if (hour < 18) {
      return "Good Afternoon";
    }

    return "Good Evening";
  };

  /* ---------------------------------------------------------
     RENDER
     --------------------------------------------------------- */

  return (
    <>
      <section className="welcome-banner">
        <div className="welcome-copy">
          <h1>
            {getGreeting()},{" "}
            {userName}
            <span>👋</span>
          </h1>

          <p>
            Manage your documents, files and
            shared content in one place.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={handleUpload}
          />

          <div className="welcome-buttons">
            <button
              type="button"
              className="welcome-primary"
              onClick={openFilePicker}
              disabled={
                uploading ||
                creatingFolder
              }
            >
              {uploading ? (
                <Loader2
                  size={16}
                  className="quick-action-spinner"
                />
              ) : (
                <FileUp size={16} />
              )}

              {uploading
                ? "Uploading..."
                : "+ Upload Files"}
            </button>

            <button
              type="button"
              className="welcome-secondary"
              onClick={openFolderDialog}
              disabled={
                uploading ||
                creatingFolder
              }
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
          </div>
        </div>

        <div
          className="welcome-illustration"
          aria-hidden="true"
        >
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />

          <div className="hero-folder">
            <div className="hero-folder-tab" />
          </div>

          <div className="floating-file file-pdf">
            PDF
          </div>

          <div className="floating-file file-doc">
            DOC
          </div>

          <div className="floating-file file-image">
            ▧
          </div>

          <div className="floating-file file-sheet">
            ▤
          </div>

          <div className="floating-file file-photo">
            ◫
          </div>
        </div>
      </section>

      {/* =====================================================
          NEW FOLDER DIALOG
          ===================================================== */}

      {showFolderDialog && (
        <div
          className="folder-dialog-overlay"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              closeFolderDialog();
            }
          }}
        >
          <div
            className="folder-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-folder-title"
          >
            {/* HEADER */}

            <div className="folder-dialog-header">
              <div className="folder-dialog-title">
                <div className="folder-dialog-icon">
                  <Folder
                    size={36}
                    fill="#FBBF24"
                    stroke="#F59E0B"
                    strokeWidth={1.5}
                  />
                </div>

                <div>
                  <h2 id="new-folder-title">
                    New Folder
                  </h2>

                  <p>
                    Create a new folder to organize
                    your files.
                  </p>
                </div>
              </div>

              <button
                type="button"
                className="folder-dialog-close"
                onClick={
                  closeFolderDialog
                }
                disabled={
                  creatingFolder
                }
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {/* BODY */}

            <div className="folder-dialog-body">
              <label
                htmlFor="folder-name"
                className="folder-name-label"
              >
                Enter folder name
              </label>

              <input
                id="folder-name"
                type="text"
                className="folder-name-input"
                value={folderName}
                onChange={(event) =>
                  setFolderName(
                    event.target.value
                  )
                }
                placeholder="Enter folder name"
                autoFocus
                maxLength={100}
                disabled={
                  creatingFolder
                }
                onKeyDown={(event) => {
                  if (
                    event.key ===
                      "Enter" &&
                    !creatingFolder
                  ) {
                    handleCreateFolder();
                  }

                  if (
                    event.key ===
                      "Escape" &&
                    !creatingFolder
                  ) {
                    closeFolderDialog();
                  }
                }}
              />

              <label className="folder-confirm-row">
                <input
                  type="checkbox"
                  checked={
                    folderConfirmed
                  }
                  onChange={(event) =>
                    setFolderConfirmed(
                      event.target
                        .checked
                    )
                  }
                  disabled={
                    creatingFolder
                  }
                />

                <span>
                  I confirm that I want to create
                  this folder
                </span>
              </label>
            </div>

            {/* FOOTER */}

            <div className="folder-dialog-footer">
              <button
                type="button"
                className="folder-cancel-button"
                onClick={
                  closeFolderDialog
                }
                disabled={
                  creatingFolder
                }
              >
                Cancel
              </button>

              <button
                type="button"
                className="folder-create-button"
                onClick={
                  handleCreateFolder
                }
                disabled={
                  creatingFolder ||
                  !folderName.trim() ||
                  !folderConfirmed
                }
              >
                {creatingFolder ? (
                  <>
                    <Loader2
                      size={15}
                      className="quick-action-spinner"
                    />
                    Creating...
                  </>
                ) : (
                  <>
                    <FolderPlus
                      size={15}
                    />
                    Create Folder
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default WelcomeBanner;