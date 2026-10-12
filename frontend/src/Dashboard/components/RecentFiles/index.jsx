import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  FileText,
  File,
  MoreHorizontal,
  Search,
  Grid2X2,
  List,
  FolderOpen,
  RefreshCw,
  Pencil,
  Trash2,
  X,
  ChevronDown,
} from "lucide-react";

import "./index.css";
import { deleteFile as deleteRemoteFile, getFile, listFiles } from "../../../services/fileApi";
import { useToast } from "../../../components/common/Toast";

const FILES_STORAGE_KEY = "fawnix_files";

/*
 * ---------------------------------------------------------
 * FILE TYPE
 * ---------------------------------------------------------
 */

const getFileExtension = (fileName = "") => {
  const parts = fileName.split(".");

  if (parts.length <= 1) {
    return "";
  }

  return parts.pop().toLowerCase();
};

const getFileType = (file) => {
  const mimeType = String(
    file?.type || ""
  ).toLowerCase();

  const extension = getFileExtension(
    file?.name
  );

  /*
   * PDF
   */
  if (
    mimeType.includes("pdf") ||
    extension === "pdf"
  ) {
    return "pdf";
  }

  /*
   * Document
   */
  if (
    mimeType.includes("word") ||
    mimeType.includes("document") ||
    ["doc", "docx"].includes(extension)
  ) {
    return "document";
  }

  /*
   * Everything else
   */
  return "file";
};

/*
 * ---------------------------------------------------------
 * FILE ICON
 * ---------------------------------------------------------
 */

const getFileIcon = (type) => {
  switch (type) {
    case "pdf":
    case "document":
      return FileText;

    default:
      return File;
  }
};

/*
 * ---------------------------------------------------------
 * FILE SIZE
 * ---------------------------------------------------------
 */

const formatFileSize = (bytes) => {
  if (
    bytes === undefined ||
    bytes === null ||
    bytes === ""
  ) {
    return "-";
  }

  const size = Number(bytes);

  if (!Number.isFinite(size)) {
    return "-";
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(
      size / 1024
    ).toFixed(1)} KB`;
  }

  if (size < 1024 * 1024 * 1024) {
    return `${(
      size /
      (1024 * 1024)
    ).toFixed(1)} MB`;
  }

  return `${(
    size /
    (1024 * 1024 * 1024)
  ).toFixed(1)} GB`;
};

/*
 * ---------------------------------------------------------
 * UPDATED TIME
 * ---------------------------------------------------------
 */

const formatModifiedDate = (file) => {
  const value =
    file?.uploadedAt ||
    file?.updatedAt ||
    file?.lastModified ||
    file?.createdAt;

  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  const now = new Date();

  const difference =
    now.getTime() -
    date.getTime();

  const minutes = Math.floor(
    difference /
      (1000 * 60)
  );

  if (minutes < 1) {
    return "Just now";
  }

  if (minutes < 60) {
    return `${minutes} ${
      minutes === 1
        ? "minute"
        : "minutes"
    } ago`;
  }

  const hours = Math.floor(
    minutes / 60
  );

  if (hours < 24) {
    return `${hours} ${
      hours === 1
        ? "hour"
        : "hours"
    } ago`;
  }

  const days = Math.floor(
    hours / 24
  );

  if (days < 7) {
    return `${days} ${
      days === 1
        ? "day"
        : "days"
    } ago`;
  }

  return date.toLocaleDateString(
    "en-IN",
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }
  );
};

/*
 * ---------------------------------------------------------
 * UPLOADER NAME
 * ---------------------------------------------------------
 *
 * Supports owner / uploadedBy / createdBy, either as an
 * object with a `name` or as a plain string.
 * ---------------------------------------------------------
 */

const getUploaderName = (file) => {
  const owner =
    file?.owner;

  const uploadedBy =
    file?.uploadedBy;

  const createdBy =
    file?.createdBy;

  /*
   * owner.name
   */
  if (
    owner &&
    typeof owner === "object" &&
    owner.name
  ) {
    return String(
      owner.name
    );
  }

  /*
   * owner
   */
  if (
    typeof owner === "string" &&
    owner.trim()
  ) {
    return owner.trim();
  }

  /*
   * uploadedBy.name
   */
  if (
    uploadedBy &&
    typeof uploadedBy === "object" &&
    uploadedBy.name
  ) {
    return String(
      uploadedBy.name
    );
  }

  /*
   * uploadedBy
   */
  if (
    typeof uploadedBy === "string" &&
    uploadedBy.trim()
  ) {
    return uploadedBy.trim();
  }

  /*
   * createdBy.name
   */
  if (
    createdBy &&
    typeof createdBy === "object" &&
    createdBy.name
  ) {
    return String(
      createdBy.name
    );
  }

  /*
   * createdBy
   */
  if (
    typeof createdBy === "string" &&
    createdBy.trim()
  ) {
    return createdBy.trim();
  }

  /*
   * Logged-in user fallback
   */
  const storedUserName =
    localStorage.getItem(
      "fawnix_user_name"
    );

  if (
    storedUserName &&
    storedUserName.trim()
  ) {
    return storedUserName.trim();
  }

  return "Unknown";
};

/*
 * ---------------------------------------------------------
 * LOAD FILES
 * ---------------------------------------------------------
 */

/*
 * ---------------------------------------------------------
 * COMPONENT
 * ---------------------------------------------------------
 */

const RadioFilterMenu = ({ label, value, options, onChange }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const selectedOption = options.find((option) => option.value === value) || options[0];

  const focusSelectedOption = () => {
    requestAnimationFrame(() => {
      rootRef.current?.querySelector('input[type="radio"]:checked')?.focus();
    });
  };

  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      setOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === "ArrowDown" && event.target === triggerRef.current) {
      event.preventDefault();
      setOpen(true);
      focusSelectedOption();
    }
  };

  return (
    <div
      className="radio-filter"
      ref={rootRef}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={(event) => {
        if (!event.currentTarget.contains(document.activeElement)) setOpen(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={handleKeyDown}
    >
      <button
        className="radio-filter-trigger"
        type="button"
        ref={triggerRef}
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selectedOption.label}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <div className="radio-filter-menu" role="radiogroup" aria-label={label}>
          {options.map((option) => (
            <label className="radio-filter-option" key={option.value}>
              <input
                type="radio"
                name={label}
                value={option.value}
                checked={value === option.value}
                onChange={() => {
                  onChange(option.value);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

const RecentFiles = ({
  refreshKey = 0,
  onFileAction,
}) => {
  const notify = useToast();
  const [files, setFiles] =
    useState([]);

  const [
    searchQuery,
    setSearchQuery,
  ] = useState("");

  const [
    filterType,
    setFilterType,
  ] = useState("all");

  const [
    sortBy,
    setSortBy,
  ] = useState("recent");

  const [
    viewMode,
    setViewMode,
  ] = useState("list");

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [activeMenuId, setActiveMenuId] = useState(null);
  const [dialogFile, setDialogFile] = useState(null);
  const [dialogMode, setDialogMode] = useState("");
  const [renameValue, setRenameValue] = useState("");

  /*
   * -------------------------------------------------------
   * LOAD FILES (initial load + refreshKey changes)
   * -------------------------------------------------------
   */

  const loadFiles = async () => {
    setLoading(true);

    try {
      setFiles(await listFiles());
    } catch (error) {
      console.error("Unable to load files:", error);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFiles();
  }, [refreshKey]);

  /*
   * -------------------------------------------------------
   * SEARCH + FILTER + SORT
   * -------------------------------------------------------
   */

  const displayedFiles =
    useMemo(() => {
      let result = [...files];

      /*
       * Search
       */
      const search =
        searchQuery
          .trim()
          .toLowerCase();

      if (search) {
        result =
          result.filter(
            (file) =>
              String(
                file?.name || ""
              )
                .toLowerCase()
                .includes(search)
          );
      }

      /*
       * File type filter
       */
      if (
        filterType !== "all"
      ) {
        result =
          result.filter(
            (file) =>
              getFileType(
                file
              ) === filterType
          );
      }

      /*
       * Sorting
       */
      result.sort((a, b) => {
        const dateA =
          new Date(
            a?.uploadedAt ||
              a?.updatedAt ||
              a?.lastModified ||
              a?.createdAt ||
              0
          ).getTime();

        const dateB =
          new Date(
            b?.uploadedAt ||
              b?.updatedAt ||
              b?.lastModified ||
              b?.createdAt ||
              0
          ).getTime();

        if (
          sortBy ===
          "oldest"
        ) {
          return (
            dateA - dateB
          );
        }

        if (
          sortBy ===
          "name"
        ) {
          return String(
            a?.name || ""
          ).localeCompare(
            String(
              b?.name || ""
            )
          );
        }

        if (
          sortBy ===
          "size"
        ) {
          return (
            Number(
              b?.size || 0
            ) -
            Number(
              a?.size || 0
            )
          );
        }

        return (
          dateB - dateA
        );
      });

      return result.slice(
        0,
        20
      );
    }, [
      files,
      searchQuery,
      filterType,
      sortBy,
    ]);

  /*
   * -------------------------------------------------------
   * FILE MENU
   * -------------------------------------------------------
   */

  const openPreview = (file) => {
    onFileAction?.(file);
    const previewTab = window.open("about:blank", "_blank");
    if (!previewTab) {
      notify("Allow pop-ups to preview this file.", "error");
      return;
    }
    getFile(file.key || file.id)
      .then((result) => {
        previewTab.location.href = result.downloadUrl;
      })
      .catch((error) => {
        previewTab.close();
        notify(error.message || "Unable to open this file.", "error");
      });
  };
  const handleFileMenu = (file) => setActiveMenuId((id) => String(id) === String(file.id) ? null : file.id);
  const deleteFile = async () => {
    try {
      await deleteRemoteFile(dialogFile.key || dialogFile.id);
      await loadFiles();
      setDialogFile(null);
    } catch (error) {
      notify(error.message || "Unable to delete this file.", "error");
    }
  };
  const renameFile = () => {
    if (!renameValue.trim()) return;
    const updated = files.map((item) => String(item.id) === String(dialogFile.id) ? { ...item, name: renameValue.trim(), updatedAt: new Date().toISOString() } : item);
    localStorage.setItem(FILES_STORAGE_KEY, JSON.stringify(updated)); setFiles(updated); setDialogFile(null);
  };

  /*
   * -------------------------------------------------------
   * EMPTY STATE
   * -------------------------------------------------------
   */

  if (
    !loading &&
    files.length === 0
  ) {
    return (
      <section className="recent-files-card">
        <div className="recent-files-header">
          <h2>
            My Files
          </h2>
        </div>

        <div className="recent-files-empty">
          <div className="recent-files-empty-icon">
            <FolderOpen
              size={28}
            />
          </div>

          <h3>
            No files yet
          </h3>

          <p>
            Upload your
            first file from
            the Quick Actions
            section.
          </p>
        </div>
      </section>
    );
  }

  /*
   * -------------------------------------------------------
   * MAIN UI
   * -------------------------------------------------------
   */

  return (
    <section className="recent-files-card">
      <div className="recent-files-header">
        <div>
          <h2>
            My Files
          </h2>

          <span className="recent-files-count">
            {files.length}{" "}
            {files.length ===
            1
              ? "file"
              : "files"}
          </span>
        </div>

        <div className="recent-files-tools">
          {/* Search */}
          <div className="mini-search">
            <Search
              size={14}
            />

            <input
              type="search"
              value={
                searchQuery
              }
              onChange={(
                event
              ) =>
                setSearchQuery(
                  event.target
                    .value
                )
              }
              placeholder="Search in files..."
              aria-label="Search files"
            />
          </div>

          <RadioFilterMenu
            label="Filter files"
            value={filterType}
            onChange={setFilterType}
            options={[
              { value: "all", label: "All files" },
              { value: "pdf", label: "PDF" },
              { value: "document", label: "Documents" },
              { value: "file", label: "Files" },
            ]}
          />

          <RadioFilterMenu
            label="Sort files"
            value={sortBy}
            onChange={setSortBy}
            options={[
              { value: "recent", label: "Sort: Recent" },
              { value: "oldest", label: "Sort: Oldest" },
              { value: "name", label: "Sort: Name" },
              { value: "size", label: "Sort: Size" },
            ]}
          />

          {/* Grid */}
          <button
            type="button"
            className={`icon-only ${
              viewMode ===
              "grid"
                ? "active"
                : ""
            }`}
            onClick={() =>
              setViewMode(
                "grid"
              )
            }
            title="Grid view"
            aria-label="Grid view"
          >
            <Grid2X2
              size={15}
            />
          </button>

          {/* List */}
          <button
            type="button"
            className={`icon-only ${
              viewMode ===
              "list"
                ? "active"
                : ""
            }`}
            onClick={() =>
              setViewMode(
                "list"
              )
            }
            title="List view"
            aria-label="List view"
          >
            <List
              size={15}
            />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="recent-files-empty">
          <RefreshCw
            size={24}
            className="quick-action-spinner"
          />

          <p>
            Loading files...
          </p>
        </div>
      ) : displayedFiles.length ===
        0 ? (
        <div className="recent-files-empty">
          <Search
            size={28}
          />

          <h3>
            No matching
            files
          </h3>

          <p>
            Try changing
            your search or
            filter.
          </p>
        </div>
      ) : (
        <div
          className={`recent-files-grid ${
            viewMode ===
            "list"
              ? "list-view"
              : "grid-view"
          }`}
        >
          {displayedFiles.map(
            (file) => {
              const type =
                getFileType(
                  file
                );

              const Icon =
                getFileIcon(
                  type
                );

              const uploader =
                getUploaderName(
                  file
                );

              const menuOpen =
                String(activeMenuId) === String(file.id);

              return (
                <article
                  className={`recent-file-card ${
                    menuOpen
                      ? "menu-open"
                      : ""
                  }`}
                  key={
                    file.id ||
                    `${file.name}-${file.lastModified}`
                  }
                  /* Close the menu automatically when the cursor leaves this row */
                  onMouseLeave={() => {
                    if (menuOpen) {
                      setActiveMenuId(null);
                    }
                  }}
                >
                  {/* File Icon */}
                  <div
                    className={`file-type-icon ${type}`}
                  >
                    <Icon
                      size={21}
                    />
                  </div>

                  {/* File Name */}
                  <button
                    type="button"
                    className="recent-file-open"
                    title={
                      `Open ${file.name} in a new tab`
                    }
                    onClick={() => openPreview(file)}
                  >
                    {file.name}
                  </button>

                  {/* File Size */}
                  <span className="file-size">
                    {formatFileSize(
                      file.size
                    )}
                  </span>

                  {/* Updated Time */}
                  <small className="file-updated">
                    {formatModifiedDate(
                      file
                    )}
                  </small>

                  {/* Uploaded By */}
                  <span
                    className="file-uploader"
                    title={`Uploaded by ${uploader}`}
                  >
                    Uploaded by{" "}
                    <strong>
                      {uploader}
                    </strong>
                  </span>

                  {/* Three Dot Menu */}
                  <button
                    type="button"
                    className="file-more"
                    onClick={() =>
                      handleFileMenu(
                        file
                      )
                    }
                    aria-label={`Actions for ${file.name}`}
                    title="File actions"
                  >
                    <MoreHorizontal
                      size={18}
                    />
                  </button>

                  {menuOpen && (
                    <div className="file-action-menu">
                      <button
                        type="button"
                        onClick={() => {
                          setDialogFile(file);
                          setRenameValue(file.name);
                          setDialogMode("rename");
                          setActiveMenuId(null);
                        }}
                      >
                        <Pencil size={15} /> Rename
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => {
                          setDialogFile(file);
                          setDialogMode("delete");
                          setActiveMenuId(null);
                        }}
                      >
                        <Trash2 size={15} /> Delete
                      </button>
                    </div>
                  )}
                </article>
              );
            }
          )}
        </div>
      )}
      {dialogFile && <div className="folder-delete-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogFile(null); }}><section className="folder-delete-dialog folder-action-dialog" role="alertdialog" aria-modal="true"><div className="folder-delete-heading"><span className="folder-delete-icon">{dialogMode === "rename" ? <Pencil size={18}/> : <Trash2 size={19}/>}</span><button className="folder-delete-close" type="button" aria-label="Close" onClick={() => setDialogFile(null)}><X size={18}/></button></div>{dialogMode === "rename" ? <><h2>Rename file</h2><label className="folder-rename-label">File name<input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} /></label><div className="folder-delete-actions"><button type="button" className="folder-action-cancel" onClick={() => setDialogFile(null)}>Cancel</button><button type="button" className="folder-action-primary" onClick={renameFile}>Update</button></div></> : <><h2>Are you sure you want to delete <strong>{dialogFile.name}</strong>?</h2><p>This file will be permanently removed.</p><div className="folder-delete-actions"><button type="button" className="folder-action-cancel" onClick={() => setDialogFile(null)}>Cancel</button><button type="button" className="folder-action-primary" onClick={deleteFile}><Trash2 size={15}/> Delete</button></div></>}</section></div>}
    </section>
  );
};

export default RecentFiles;