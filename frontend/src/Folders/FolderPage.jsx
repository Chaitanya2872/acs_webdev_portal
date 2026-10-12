import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  File,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  Upload,
  Eye,
  Pencil,
  X,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import "./FolderPage.css";
import {
  createFolder,
  deleteFolder,
  getFolderContents,
  renameFolder,
} from "../services/folderApi";
import { deleteFile, getFile, renameFile } from "../services/fileApi";
import { uploadFiles } from "../services/uploadApi";

const fileType = (file) => {
  const extension = String(file.name || "").split(".").pop().toLowerCase();
  const mime = String(file.type || "").toLowerCase();
  if (extension === "pdf" || mime.includes("pdf")) return "pdf";
  if (["doc", "docx", "txt", "rtf"].includes(extension) || mime.includes("word") || mime.includes("text")) return "document";
  if (["xls", "xlsx", "csv"].includes(extension) || mime.includes("sheet") || mime.includes("csv")) return "spreadsheet";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension) || mime.startsWith("image/")) return "image";
  return "other";
};

const formatSize = (value) => {
  const size = Number(value) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const FolderPage = () => {
  const { folderId } = useParams();
  const inputRef = useRef(null);
  const [folder, setFolder] = useState(null);
  const [folderError, setFolderError] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [files, setFiles] = useState([]);
  const [childFolders, setChildFolders] = useState([]);
  const [childSearch, setChildSearch] = useState("");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sort, setSort] = useState("recent");
  const [activeMenu, setActiveMenu] = useState(null);
  const [dialogItem, setDialogItem] = useState(null);
  const [dialogMode, setDialogMode] = useState("");
  const [renameValue, setRenameValue] = useState("");

  // New folder card
  const [showCreate, setShowCreate] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderConfirmed, setNewFolderConfirmed] = useState(false);
  const [createError, setCreateError] = useState("");

  const reload = async () => {
    try {
      const result = await getFolderContents(folderId);
      setFolder({
        id: result.folderName,
        name: result.folderName.split("/").pop() || result.folderName,
        folderName: result.folderName,
        owner: "You",
      });
      setChildFolders(result.folders);
      setFiles(result.files);
      setFolderError("");
    } catch (error) {
      setFolder(null);
      setFolderError(error.message || "Unable to load this folder.");
    }
  };

  useEffect(() => {
    reload();
    // Route changes select a different folder and reload its contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId]);

  /* Close the three-dot menu when clicking anywhere else */
  useEffect(() => {
    if (!activeMenu) return undefined;
    const handleOutside = (event) => {
      if (!event.target.closest("[data-menu]")) setActiveMenu(null);
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [activeMenu]);

  /* Close cards with Escape */
  useEffect(() => {
    if (!showCreate && !dialogItem) return undefined;
    const handleKey = (event) => {
      if (event.key !== "Escape") return;
      if (showCreate) closeCreateDialog();
      else setDialogItem(null);
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCreate, dialogItem]);

  const visibleFiles = useMemo(() => {
    const search = query.trim().toLowerCase();
    return [...files]
      .filter((file) => !search || String(file.name || "").toLowerCase().includes(search))
      .filter((file) => typeFilter === "all" || fileType(file) === typeFilter)
      .sort((a, b) => {
        if (sort === "name") return String(a.name || "").localeCompare(String(b.name || ""));
        const dateA = new Date(a.uploadedAt || a.createdAt || 0).getTime();
        const dateB = new Date(b.uploadedAt || b.createdAt || 0).getTime();
        return sort === "oldest" ? dateA - dateB : dateB - dateA;
      });
  }, [files, query, typeFilter, sort]);

  const visibleChildFolders = childFolders.filter((child) =>
    String(child.name || "").toLowerCase().includes(childSearch.trim().toLowerCase())
  );

  const addDocuments = async (event) => {
    const selected = Array.from(event.target.files || []);
    if (!selected.length) return;
    try {
      const uploaded = await uploadFiles(selected, folder.folderName);
      await reload();
      setFeedback({
        type: "success",
        message: `${uploaded.length} ${uploaded.length === 1 ? "file" : "files"} uploaded successfully.`,
      });
    } catch (error) {
      if (error.uploadedFiles?.length) await reload();
      setFeedback({ type: "error", message: error.message || "Unable to upload documents." });
    } finally {
      event.target.value = "";
    }
  };

  /* ---------------- NEW FOLDER CARD ---------------- */

  const openCreateDialog = () => {
    setNewFolderName("");
    setNewFolderConfirmed(false);
    setCreateError("");
    setShowCreate(true);
  };

  function closeCreateDialog() {
    setShowCreate(false);
    setNewFolderName("");
    setNewFolderConfirmed(false);
    setCreateError("");
  }

  const createSubfolder = async () => {
    const trimmedName = newFolderName.trim();
    if (!trimmedName) {
      setCreateError("Please enter a folder name.");
      return;
    }
    if (!newFolderConfirmed) {
      setCreateError("Please confirm the checkbox before creating the folder.");
      return;
    }
    const duplicate = childFolders.some((item) =>
      item.name.toLowerCase() === trimmedName.toLowerCase()
    );
    if (duplicate) {
      setCreateError("A folder with this name already exists here.");
      return;
    }
    try {
      await createFolder(`${folder.folderName}/${trimmedName}`);
      await reload();
      closeCreateDialog();
      setFeedback({ type: "success", message: `Folder “${trimmedName}” created.` });
    } catch (error) {
      setCreateError(error.message || "Unable to create folder.");
    }
  };

  /* ---------------- DELETE / RENAME ---------------- */

  const deleteSubfolder = async (child) => {
    await deleteFolder(child.folderName);
    await reload();
    setFeedback({ type: "success", message: `Folder “${child.name}” deleted.` });
  };

  const deleteDocument = async (file) => {
    await deleteFile(file.key);
    await reload();
    setFeedback({ type: "success", message: `File “${file.name}” deleted.` });
  };

  const confirmDelete = async () => {
    if (!dialogItem) return;
    try {
      if (dialogItem.kind === "folder") await deleteSubfolder(dialogItem.item);
      else await deleteDocument(dialogItem.item);
      setDialogItem(null);
    } catch (error) {
      setFeedback({ type: "error", message: error.message || "Unable to delete this item." });
    }
  };

  const renameItem = async () => {
    const nextName = renameValue.trim();
    if (!nextName || !dialogItem) return;
    try {
      if (dialogItem.kind === "folder") {
        await renameFolder(dialogItem.item.folderName, nextName);
      } else {
        await renameFile(dialogItem.item.key, nextName);
      }
      await reload();
      setFeedback({ type: "success", message: `“${dialogItem.item.name}” renamed to “${nextName}”.` });
      setDialogItem(null);
    } catch (error) {
      setFeedback({ type: "error", message: error.message || "Unable to rename this item." });
    }
  };

  const previewFile = (file) => {
    const previewTab = window.open("about:blank", "_blank");
    if (!previewTab) {
      setFeedback({ type: "error", message: "Allow pop-ups to preview this file." });
      return;
    }
    getFile(file.key)
      .then((result) => { previewTab.location.href = result.downloadUrl; })
      .catch((error) => {
        previewTab.close();
        setFeedback({ type: "error", message: error.message || "Unable to open this file." });
      });
  };

  const toggleMenu = (menuId) => setActiveMenu((id) => (id === menuId ? null : menuId));

  const openItemDialog = (kind, item, mode) => {
    setDialogItem({ kind, item });
    setDialogMode(mode);
    if (mode === "rename") setRenameValue(item.name);
    setActiveMenu(null);
  };

  if (!folder) {
    return <div className="folder-page">{folderError || "Loading folder..."}</div>;
  }

  return (
    <div className="folder-page">
      <Link className="folder-back-link" to="/"><ArrowLeft size={16} /> Dashboard</Link>
      <header className="folder-page-header">
        <img src="/folder-icon.svg" alt=""/>
        <div className="folder-page-title">
          <h1>{folder.name}</h1>
          <p>Created by {folder.owner || "Unknown"} · {files.length} {files.length === 1 ? "document" : "documents"}</p>
        </div>
        <input ref={inputRef} className="folder-file-input" type="file" multiple onChange={addDocuments} />
        <button className="folder-new-button" type="button" onClick={openCreateDialog}><Plus size={16} /> New folder</button>
        <button className="folder-upload-button" type="button" onClick={() => inputRef.current?.click()}><Upload size={16} /> Add documents</button>
      </header>

      {feedback && (
        <div className={`folder-feedback ${feedback.type}`} role={feedback.type === "error" ? "alert" : "status"}>
          <span>{feedback.message}</span>
          <button type="button" aria-label="Dismiss message" onClick={() => setFeedback(null)}><X size={16} /></button>
        </div>
      )}

      {childFolders.length > 0 && (
        <section className="folder-subfolders">
          <div className="folder-subfolders-heading">
            <h2>Folders</h2>
            <label className="folder-subfolder-search"><Search size={14} /><input value={childSearch} onChange={(event) => setChildSearch(event.target.value)} placeholder="Search folders" aria-label="Search folders" /></label>
          </div>
          <div className="folder-subfolder-grid">
            {visibleChildFolders.map((child) => (
              <div className="folder-subfolder-card" key={child.id}>
                <Link to={`/folders/${encodeURIComponent(child.id)}`}>
                  <img src="/folder-icon.svg" alt="" />
                  <span><strong>{child.name}</strong><small>Created by {child.owner || "Unknown"}</small></span>
                </Link>
                <button
                  type="button"
                  data-menu
                  aria-label={`Actions for ${child.name}`}
                  title="Folder options"
                  onClick={() => toggleMenu(`folder-${child.id}`)}
                >
                  <MoreHorizontal size={18} />
                </button>
                {activeMenu === `folder-${child.id}` && (
                  <div className="folder-action-menu" data-menu>
                    <button type="button" onClick={() => openItemDialog("folder", child, "view")}><Eye size={15} /> View</button>
                    <button type="button" onClick={() => openItemDialog("folder", child, "rename")}><Pencil size={15} /> Rename</button>
                    <button type="button" className="danger" onClick={() => openItemDialog("folder", child, "delete")}><Trash2 size={15} /> Delete</button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {visibleChildFolders.length === 0 && <p className="folder-subfolder-no-results">No folders match your search.</p>}
        </section>
      )}

      <section className="folder-documents-card">
        <div className="folder-documents-toolbar">
          <div className="folder-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search documents" aria-label="Search documents" /></div>
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="Filter by document type">
            <option value="all">All types</option><option value="document">Documents</option><option value="pdf">PDF</option>
          </select>
          <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort documents">
            <option value="recent">Newest first</option><option value="oldest">Oldest first</option><option value="name">Name</option>
          </select>
        </div>

        {visibleFiles.length ? (
          <div className="folder-document-list">
            {visibleFiles.map((file) => {
              const Icon = ["pdf", "document"].includes(fileType(file)) ? FileText : File;
              return (
                <article className="folder-document-row" key={file.id}>
                  <span className={`folder-document-icon ${fileType(file)}`}><Icon size={18} /></span>
                  <button className="folder-document-name" title={`Open ${file.name} in a new tab`} type="button" onClick={() => previewFile(file)}>{file.name}</button>
                  <span className="folder-document-type">{fileType(file)}</span>
                  <span className="folder-document-size">{formatSize(file.size)}</span>
                  <span className="folder-document-date">{new Date(file.uploadedAt || file.createdAt || Date.now()).toLocaleDateString()}</span>
                  <button
                    className="folder-document-delete"
                    type="button"
                    data-menu
                    aria-label={`Actions for ${file.name}`}
                    title="File options"
                    onClick={() => toggleMenu(`file-${file.id}`)}
                  >
                    <MoreHorizontal size={17} />
                  </button>
                  {activeMenu === `file-${file.id}` && (
                    <div className="folder-action-menu folder-file-action-menu" data-menu>
                      <button type="button" onClick={() => { previewFile(file); setActiveMenu(null); }}><Eye size={15} /> View</button>
                      <button type="button" onClick={() => openItemDialog("file", file, "rename")}><Pencil size={15} /> Rename</button>
                      <button type="button" className="danger" onClick={() => openItemDialog("file", file, "delete")}><Trash2 size={15} /> Delete</button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="folder-empty-state"><FolderOpen size={30} /><h2>{files.length ? "No matching documents" : "No documents in this folder yet"}</h2><p>{files.length ? "Try another search or file type." : "Add documents to keep them together in this folder."}</p></div>
        )}
      </section>

      {/* =====================================================
          NEW FOLDER CARD
          ===================================================== */}
      {showCreate && (
        <div
          className="fp-overlay"
          onMouseDown={(event) => { if (event.target === event.currentTarget) closeCreateDialog(); }}
        >
          <div className="fp-modal" role="dialog" aria-modal="true" aria-labelledby="fp-new-folder-title">
            <div className="fp-modal-header fp-modal-header-row">
              <div className="fp-modal-title">
                <div className="fp-modal-folder-icon">
                  <Folder size={36} fill="#FBBF24" stroke="#F59E0B" strokeWidth={1.5} />
                </div>
                <div>
                  <h2 id="fp-new-folder-title">New Folder</h2>
                  <p>Create a new folder to organize your files.</p>
                </div>
              </div>
              <button type="button" className="fp-modal-close" aria-label="Close" onClick={closeCreateDialog}><X size={18} /></button>
            </div>

            <div className="fp-modal-body">
              <label htmlFor="fp-folder-name" className="fp-label">Enter folder name</label>
              <input
                id="fp-folder-name"
                type="text"
                className="fp-input"
                value={newFolderName}
                onChange={(event) => { setNewFolderName(event.target.value); setCreateError(""); }}
                placeholder="Enter folder name"
                autoFocus
                maxLength={100}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && newFolderName.trim() && newFolderConfirmed) createSubfolder();
                }}
              />
              <label className="fp-confirm-row">
                <input
                  type="checkbox"
                  checked={newFolderConfirmed}
                  onChange={(event) => { setNewFolderConfirmed(event.target.checked); setCreateError(""); }}
                />
                <span>I confirm that I want to create this folder</span>
              </label>
              {createError && <p className="fp-error">{createError}</p>}
            </div>

            <div className="fp-modal-footer">
              <button type="button" className="fp-btn fp-btn-cancel" onClick={closeCreateDialog}>Cancel</button>
              <button
                type="button"
                className="fp-btn fp-btn-primary"
                onClick={createSubfolder}
                disabled={!newFolderName.trim() || !newFolderConfirmed}
              >
                <FolderPlus size={15} /> Create Folder
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================
          VIEW / RENAME / DELETE CARDS
          ===================================================== */}
      {dialogItem && (
        <div
          className="fp-overlay"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogItem(null); }}
        >
          <section
            className="fp-modal"
            role={dialogMode === "delete" ? "alertdialog" : "dialog"}
            aria-modal="true"
          >
            <div className="fp-modal-header fp-modal-header-row">
              <span className={`fp-icon-box ${dialogMode === "view" ? "fp-icon-view" : ""}`}>
                {dialogMode === "view" ? <FolderOpen size={19} /> : dialogMode === "rename" ? <Pencil size={18} /> : <Trash2 size={19} />}
              </span>
              <button className="fp-modal-close" type="button" aria-label="Close" onClick={() => setDialogItem(null)}><X size={18} /></button>
            </div>

            {dialogMode === "view" && (
              <>
                <div className="fp-modal-body fp-modal-body-tight">
                  <h2 className="fp-heading">{dialogItem.item.name}</h2>
                  <p className="fp-text">{dialogItem.kind === "folder" ? "Folder details" : `${fileType(dialogItem.item)} · ${formatSize(dialogItem.item.size)}`}</p>
                  {dialogItem.kind === "folder" && (
                    <div className="folder-content-counts">
                      <span><FolderOpen size={18} /><strong>{childFolders.length}</strong><small>Subfolders</small></span>
                      <span><FileText size={18} /><strong>{files.length}</strong><small>Documents</small></span>
                    </div>
                  )}
                </div>
                <div className="fp-modal-footer">
                  {dialogItem.kind === "file" && (
                    <button className="fp-btn fp-btn-cancel" type="button" onClick={() => previewFile(dialogItem.item)}>Open in new tab</button>
                  )}
                  <button className="fp-btn fp-btn-primary" type="button" onClick={() => setDialogItem(null)}>Done</button>
                </div>
              </>
            )}

            {dialogMode === "rename" && (
              <>
                <div className="fp-modal-body fp-modal-body-tight">
                  <h2 className="fp-heading">Rename {dialogItem.kind === "folder" ? "folder" : "file"}</h2>
                  <label className="fp-label fp-label-muted" htmlFor="fp-rename-input">
                    {dialogItem.kind === "folder" ? "Folder name" : "File name"}
                  </label>
                  <input
                    id="fp-rename-input"
                    className="fp-input"
                    autoFocus
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") renameItem(); }}
                  />
                </div>
                <div className="fp-modal-footer">
                  <button type="button" className="fp-btn fp-btn-cancel" onClick={() => setDialogItem(null)}>Cancel</button>
                  <button type="button" className="fp-btn fp-btn-primary" onClick={renameItem} disabled={!renameValue.trim()}>Update</button>
                </div>
              </>
            )}

            {dialogMode === "delete" && (
              <>
                <div className="fp-modal-body fp-modal-body-tight">
                  <h2 className="fp-heading">Are you sure you want to delete <strong>{dialogItem.item.name}</strong>?</h2>
                  <p className="fp-text">{dialogItem.kind === "folder" ? "Its nested folders and documents will also be deleted." : "This file will be permanently removed."}</p>
                </div>
                <div className="fp-modal-footer">
                  <button type="button" className="fp-btn fp-btn-cancel" onClick={() => setDialogItem(null)}>Cancel</button>
                  <button type="button" className="fp-btn fp-btn-primary" onClick={confirmDelete}><Trash2 size={15} /> Delete</button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
};

export default FolderPage;