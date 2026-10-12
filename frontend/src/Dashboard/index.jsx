
import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  MoreHorizontal,
  Search,
  Trash2,
  X,
  Eye,
  Pencil,
  FolderOpen,
  FileText,
  Loader2,
} from "lucide-react";

import WelcomeBanner from "./components/WelcomeBanner";
import RecentFiles from "./components/RecentFiles";

import {
  deleteFolder,
  getFolderContents,
  listFolders,
  renameFolder,
} from "../services/folderApi";

import "./index.css";

const normalizeFolder = (folder = {}) => {
  const folderName =
    typeof folder === "string"
      ? folder
      : folder.folderName || folder.name || "";

  return {
    ...(typeof folder === "object" ? folder : {}),
    id: String(
      typeof folder === "object"
        ? folder.id || folder.folderName || folder.name || folderName
        : folderName
    ),
    name: folderName.split("/").pop() || folderName,
    folderName,
    owner: typeof folder === "object" ? folder.owner || "You" : "You",
    parentId: typeof folder === "object" ? folder.parentId || null : null,
  };
};

const Dashboard = () => {
  const [folders, setFolders] = useState([]);
  const [folderToDelete, setFolderToDelete] = useState(null);
  const [folderToView, setFolderToView] = useState(null);
  const [folderToRename, setFolderToRename] = useState(null);
  const [folderName, setFolderName] = useState("");
  const [openMenuId, setOpenMenuId] = useState(null);
  const [folderSearch, setFolderSearch] = useState("");
  const [loadingFolders, setLoadingFolders] = useState(true);
  const [folderError, setFolderError] = useState("");
  const [folderContents, setFolderContents] = useState(null);
  const [loadingContents, setLoadingContents] = useState(false);
  const [filesRefreshKey, setFilesRefreshKey] = useState(0);

  // Load folders from the backend.
  const loadFolders = useCallback(async () => {
    setLoadingFolders(true);
    setFolderError("");

    try {
      const result = await listFolders();
      const normalized = (Array.isArray(result) ? result : []).map(
        normalizeFolder
      );

      setFolders(normalized);
    } catch (error) {
      console.error("Unable to load folders:", error);
      setFolderError(
        error.message || "Unable to load folders. Please try again."
      );
    } finally {
      setLoadingFolders(false);
    }
  }, []);

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);

  // WelcomeBanner should call this callback after creating a folder.
  // Refreshing avoids inserting a local-only folder into the dashboard.
  const handleFolderCreated = useCallback(async () => {
    await loadFolders();
  }, [loadFolders]);

  const handleFilesUploaded = useCallback(async () => {
    setFilesRefreshKey((current) => current + 1);
    await loadFolders();
  }, [loadFolders]);

  const topLevelFolders = folders.filter((folder) => !folder.parentId);

  const visibleFolders = topLevelFolders.filter((folder) =>
    String(folder.name || "")
      .toLowerCase()
      .includes(folderSearch.trim().toLowerCase())
  );

  // Fetch real folder contents from the backend.
  const handleViewFolder = async (folder) => {
    setFolderToView(folder);
    setFolderContents(null);
    setLoadingContents(true);
    setOpenMenuId(null);

    try {
      const result = await getFolderContents(folder.folderName);

      setFolderContents({
        folders: Array.isArray(result?.folders)
          ? result.folders.length
          : 0,
        files: Array.isArray(result?.files) ? result.files.length : 0,
      });
    } catch (error) {
      console.error("Unable to load folder contents:", error);
      setFolderContents({
        error: error.message || "Unable to load folder contents.",
      });
    } finally {
      setLoadingContents(false);
    }
  };

  const handleDeleteFolder = async () => {
    if (!folderToDelete) return;

    try {
      await deleteFolder(folderToDelete.folderName);
      setFolderToDelete(null);
      setFilesRefreshKey((current) => current + 1);
      await loadFolders();
    } catch (error) {
      setFolderError(error.message || "Unable to delete the folder.");
    }
  };

  const handleRenameFolder = async (event) => {
    event?.preventDefault();

    if (!folderToRename || !folderName.trim()) return;

    try {
      await renameFolder(folderToRename.folderName, folderName.trim());
      setFolderToRename(null);
      setFolderName("");
      await loadFolders();
    } catch (error) {
      setFolderError(error.message || "Unable to rename the folder.");
    }
  };

  return (
    <div className="fawnix-dashboard">
      <WelcomeBanner
        onFolderCreated={handleFolderCreated}
        onFilesUploaded={handleFilesUploaded}
      />

      <section
        className="dashboard-folders"
        aria-labelledby="dashboard-folders-title"
      >
        <div className="dashboard-folders-heading">
          <h2 id="dashboard-folders-title">My Folders</h2>

          <span>
            {topLevelFolders.length}{" "}
            {topLevelFolders.length === 1 ? "folder" : "folders"}
          </span>

        </div>

        <label className="dashboard-folder-search">
          <Search size={16} />

          <input
            value={folderSearch}
            onChange={(event) => setFolderSearch(event.target.value)}
            placeholder="Search folders"
            aria-label="Search folders"
          />
        </label>

        {folderError && (
          <div role="alert" className="dashboard-folders-error">
            <p>{folderError}</p>

            <button type="button" onClick={loadFolders}>
              Try again
            </button>
          </div>
        )}

        {loadingFolders ? (
          <div className="dashboard-folders-loading" role="status">
            <Loader2 size={20} className="animate-spin" />
            <span>Loading folders...</span>
          </div>
        ) : (
          <>
            <div className="dashboard-folders-grid">
              {visibleFolders.map((folder) => (
                <div
                  className="dashboard-folder-item"
                  key={folder.id}
                >
                  <Link
                    className="dashboard-folder-card"
                    to={`/folders/${encodeURIComponent(
                      folder.folderName
                    )}`}
                  >
                    <img
                      className="dashboard-folder-icon"
                      src="/folder-icon.svg"
                      alt=""
                    />

                    <div className="dashboard-folder-copy">
                      <strong title={folder.name}>
                        {folder.name}
                      </strong>

                      <span>
                        Created by {folder.owner || "You"}
                      </span>
                    </div>
                  </Link>

                  <button
                    className="dashboard-folder-menu-button"
                    type="button"
                    aria-label={`Actions for ${folder.name}`}
                    title="Folder options"
                    aria-expanded={openMenuId === folder.id}
                    onClick={() =>
                      setOpenMenuId((current) =>
                        current === folder.id ? null : folder.id
                      )
                    }
                  >
                    <MoreHorizontal size={18} />
                  </button>

                  {openMenuId === folder.id && (
                    <div className="folder-action-menu">
                      <button
                        type="button"
                        onClick={() => handleViewFolder(folder)}
                      >
                        <Eye size={15} />
                        View
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setFolderToRename(folder);
                          setFolderName(folder.name);
                          setOpenMenuId(null);
                        }}
                      >
                        <Pencil size={15} />
                        Rename
                      </button>

                      <button
                        type="button"
                        className="danger"
                        onClick={() => {
                          setFolderToDelete(folder);
                          setOpenMenuId(null);
                        }}
                      >
                        <Trash2 size={15} />
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {visibleFolders.length === 0 && (
              <p className="dashboard-folders-no-results">
                {folderError
                  ? "Folders could not be loaded."
                  : folderSearch.trim()
                    ? "No folders match your search."
                    : "No folders yet. Create a folder to get started."}
              </p>
            )}
          </>
        )}
      </section>

      <section className="dashboard-my-files">
        <RecentFiles refreshKey={filesRefreshKey} />
      </section>

      {/* Delete confirmation */}
      {folderToDelete && (
        <div
          className="folder-delete-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setFolderToDelete(null);
            }
          }}
        >
          <section
            className="folder-delete-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="folder-delete-title"
          >
            <div className="folder-delete-heading">
              <span className="folder-delete-icon">
                <Trash2 size={19} />
              </span>

              <button
                className="folder-delete-close"
                type="button"
                aria-label="Close"
                onClick={() => setFolderToDelete(null)}
              >
                <X size={18} />
              </button>
            </div>

            <h2 id="folder-delete-title">
              Delete <strong>{folderToDelete.name}</strong>?
            </h2>

            <p>
              This permanently deletes the folder, its nested folders, and all files inside it.
            </p>

            <div className="folder-delete-actions">
              <button
                type="button"
                className="folder-delete-cancel"
                onClick={() => setFolderToDelete(null)}
              >
                Cancel
              </button>

              <button
                type="button"
                className="folder-delete-confirm"
                onClick={handleDeleteFolder}
              >
                <Trash2 size={15} />
                Delete folder
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Folder details */}
      {folderToView && (
        <div
          className="folder-delete-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setFolderToView(null);
              setFolderContents(null);
            }
          }}
        >
          <section
            className="folder-delete-dialog folder-action-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="folder-view-title"
          >
            <div className="folder-delete-heading">
              <span className="folder-delete-icon">
                <FolderOpen size={19} />
              </span>

              <button
                className="folder-delete-close"
                type="button"
                aria-label="Close"
                onClick={() => {
                  setFolderToView(null);
                  setFolderContents(null);
                }}
              >
                <X size={18} />
              </button>
            </div>

            <h2 id="folder-view-title">{folderToView.name}</h2>

            <p>Contents retrieved from the backend</p>

            {loadingContents ? (
              <div role="status" className="dashboard-folders-loading">
                <Loader2 size={20} className="animate-spin" />
                <span>Loading folder contents...</span>
              </div>
            ) : folderContents?.error ? (
              <p role="alert">{folderContents.error}</p>
            ) : folderContents ? (
              <div className="folder-content-counts">
                <span>
                  <FolderOpen size={18} />
                  <strong>{folderContents.folders}</strong>
                  <small>Subfolders</small>
                </span>

                <span>
                  <FileText size={18} />
                  <strong>{folderContents.files}</strong>
                  <small>Files &amp; documents</small>
                </span>
              </div>
            ) : null}

            <div className="folder-delete-actions">
              <button
                type="button"
                className="folder-action-primary"
                onClick={() => {
                  setFolderToView(null);
                  setFolderContents(null);
                }}
              >
                Done
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Rename dialog */}
      {folderToRename && (
        <div
          className="folder-delete-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setFolderToRename(null);
              setFolderName("");
            }
          }}
        >
          <form
            className="folder-delete-dialog folder-action-dialog"
            onSubmit={handleRenameFolder}
          >
            <div className="folder-delete-heading">
              <span className="folder-delete-icon">
                <Pencil size={18} />
              </span>

              <button
                className="folder-delete-close"
                type="button"
                aria-label="Close"
                onClick={() => {
                  setFolderToRename(null);
                  setFolderName("");
                }}
              >
                <X size={18} />
              </button>
            </div>

            <h2>Rename folder</h2>

            <label className="folder-rename-label">
              Folder name

              <input
                autoFocus
                value={folderName}
                onChange={(event) => setFolderName(event.target.value)}
                required
              />
            </label>

            <p>
              Files and nested folders will be kept under the renamed folder.
            </p>

            <div className="folder-delete-actions">
              <button
                type="button"
                className="folder-action-cancel"
                onClick={() => {
                  setFolderToRename(null);
                  setFolderName("");
                }}
              >
                Cancel
              </button>

              <button
                type="submit"
                className="folder-action-primary"
              >
                Update
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default Dashboard;