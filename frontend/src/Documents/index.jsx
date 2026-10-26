import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FilePlus2,
  Globe2,
  Info,
  Loader2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";

import { useToast } from "../components/common/Toast";
import {
  changeDocumentStatus,
  deleteDocument,
  getDocumentFileUrl,
  listCategories,
  listDocuments,
  listFinancialYears,
} from "../services/documentApi";
import { canPublish, getSessionUser, isAdmin } from "../services/session";
import ConfirmDialog from "./ConfirmDialog";
import DocumentDetailsDialog from "./DocumentDetailsDialog";
import DocumentFormDialog from "./DocumentFormDialog";
import ReplaceFileDialog from "./ReplaceFileDialog";
import { STATUS_LABELS, formatDate, indexCategories, websitePageUrl } from "./documentUtils";

import "../Folders/FolderPage.css";
import "./index.css";

const PAGE_SIZE = 25;

const STATUS_ACTIONS = {
  publish: { label: "Publish", done: "published", confirm: null },
  unpublish: { label: "Unpublish", done: "unpublished", confirm: "It will disappear from the website within a minute. You can publish it again later." },
  archive: { label: "Archive", done: "archived", confirm: "Archived documents are hidden from the website and from the default list. They can be restored." },
  restore: { label: "Restore", done: "restored (unpublished)", confirm: null },
};

const WebsiteDocuments = () => {
  const notify = useToast();
  const user = getSessionUser();
  const editor = canPublish(user);
  const admin = isAdmin(user);

  const [categories, setCategories] = useState({ tree: [], byId: new Map(), leaves: [] });
  const [years, setYears] = useState([]);
  const [filters, setFilters] = useState({ q: "", categoryId: "", status: "active", financialYear: "" });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ items: [], pagination: { total: 0, totalPages: 1 } });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [menuId, setMenuId] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  useEffect(() => {
    listCategories()
      .then((tree) => setCategories({ tree, ...indexCategories(tree) }))
      .catch((error) => setLoadError(error.message));
  }, []);

  useEffect(() => {
    listFinancialYears().then(setYears).catch(() => setYears([]));
  }, [refreshKey]);

  // Debounce the search box.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((current) => (current.q === search.trim() ? current : { ...current, q: search.trim() }));
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    listDocuments({ ...filters, page, pageSize: PAGE_SIZE })
      .then((data) => {
        if (!active) return;
        setResult(data);
        setLoadError("");
      })
      .catch((error) => active && setLoadError(error.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [filters, page, refreshKey]);

  useEffect(() => {
    if (!menuId) return undefined;
    const close = (event) => { if (!event.target.closest?.("[data-menu]")) setMenuId(null); };
    const escape = (event) => event.key === "Escape" && setMenuId(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [menuId]);

  const setFilter = (name, value) => {
    setFilters((current) => ({ ...current, [name]: value }));
    setPage(1);
  };

  const openFile = async (doc, download = false) => {
    setMenuId(null);
    const tab = download ? null : window.open("about:blank", "_blank");
    try {
      const { downloadUrl } = await getDocumentFileUrl(doc.id, { download });
      if (tab) tab.location.href = downloadUrl;
      else window.location.assign(downloadUrl);
    } catch (error) {
      tab?.close();
      notify(error.message);
    }
  };

  const runStatus = async (doc, action) => {
    try {
      await changeDocumentStatus(doc.id, action);
      notify(`“${doc.title}” ${STATUS_ACTIONS[action].done}.`, "success");
      setDialog(null);
      refresh();
    } catch (error) {
      notify(error.message);
    }
  };

  const requestStatus = (doc, action) => {
    setMenuId(null);
    const { confirm, label } = STATUS_ACTIONS[action];
    if (!confirm) {
      runStatus(doc, action);
      return;
    }
    setDialog({ type: "confirm", title: `${label} “${doc.title}”?`, message: confirm, confirmLabel: label, danger: action !== "publish", onConfirm: () => runStatus(doc, action) });
  };

  const requestDelete = (doc) => {
    setMenuId(null);
    setDialog({
      type: "confirm",
      title: `Delete “${doc.title}” permanently?`,
      message: `This removes the document, all ${doc.versionCount} file version(s) from storage and its website listing. This cannot be undone.${doc.legacyPath ? " The original file on the old web server is not affected." : ""}`,
      confirmLabel: "Delete permanently",
      danger: true,
      requireTyping: "DELETE",
      onConfirm: async () => {
        try {
          await deleteDocument(doc.id);
          notify(`“${doc.title}” deleted.`, "success");
          setDialog(null);
          refresh();
        } catch (error) {
          notify(error.message);
        }
      },
    });
  };

  const onSaved = (saved, warnings = [], verb = "saved") => {
    setDialog(null);
    notify(`“${saved.title}” ${verb}${saved.status === "published" ? " and live on the website" : ""}.`, "success");
    warnings.forEach((warning) => notify(warning, "info"));
    refresh();
  };

  const { items, pagination } = result;
  const firstRow = pagination.total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const lastRow = Math.min(page * PAGE_SIZE, pagination.total);
  const categoryOptions = useMemo(() => categories.tree.filter((node) => node.isActive), [categories.tree]);

  return (
    <div className="wd-page">
      <header className="folder-page-header wd-header">
        <div className="wd-header-icon"><Globe2 size={24} /></div>
        <div className="folder-page-title">
          <h1>Website Documents</h1>
          <p>PDFs published here appear on acstechnologies.co.in automatically — no website changes needed.</p>
        </div>
        {editor && (
          <button type="button" className="fp-btn fp-btn-primary wd-upload-button" onClick={() => setDialog({ type: "create" })} disabled={!categories.tree.length}>
            <FilePlus2 size={16} /> Upload document
          </button>
        )}
      </header>

      <section className="folder-documents-card wd-card">
        <div className="folder-documents-toolbar wd-toolbar">
          <div className="folder-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search titles and file names" aria-label="Search documents" /></div>
          <select value={filters.categoryId} onChange={(event) => setFilter("categoryId", event.target.value)} aria-label="Filter by website section">
            <option value="">All sections</option>
            {categoryOptions.map((node) => (
              node.isLeaf
                ? <option key={node.id} value={node.id}>{node.name}</option>
                : (
                  <optgroup key={node.id} label={node.name}>
                    <option value={node.id}>All {node.name}</option>
                    {node.children.filter((child) => child.isActive).map((child) => <option key={child.id} value={child.id}>{child.name}</option>)}
                  </optgroup>
                )
            ))}
          </select>
          <select value={filters.status} onChange={(event) => setFilter("status", event.target.value)} aria-label="Filter by status">
            <option value="active">All except archived</option>
            <option value="published">Published</option>
            <option value="draft">Drafts</option>
            <option value="unpublished">Unpublished</option>
            <option value="archived">Archived</option>
          </select>
          <select value={filters.financialYear} onChange={(event) => setFilter("financialYear", event.target.value)} aria-label="Filter by financial year">
            <option value="">All years</option>
            {years.map((year) => <option key={year} value={year}>FY {year}</option>)}
          </select>
          <button type="button" className="wd-icon-button" title="Refresh" aria-label="Refresh list" onClick={refresh}><RefreshCw size={16} /></button>
        </div>

        {loadError && <div className="folder-feedback error" role="alert"><span>{loadError}</span></div>}

        <div className="wd-table-wrap">
          <table className="wd-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Website section</th>
                <th>Year</th>
                <th>Date</th>
                <th>Status</th>
                <th>Updated</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {items.map((doc) => {
                const primaryUrl = websitePageUrl(categories.byId.get(doc.categoryId));
                return (
                  <tr key={doc.id}>
                    <td className="wd-title-cell">
                      <button type="button" className="wd-title-button" onClick={() => setDialog({ type: "details", id: doc.id })}>{doc.title}</button>
                      <small>{doc.displayFilename}{doc.versionCount > 1 ? ` · v${doc.currentVersion?.version}` : ""}</small>
                    </td>
                    <td>
                      <span className="wd-section">{doc.categoryPath}</span>
                      {doc.placements.length > 1 && <small className="wd-more" title={doc.placements.filter((p) => !p.isPrimary).map((p) => p.path).join("\n")}>+{doc.placements.length - 1} more</small>}
                    </td>
                    <td>{doc.financialYear || "—"}</td>
                    <td>{formatDate(doc.documentDate)}</td>
                    <td><span className={`wd-status wd-status-${doc.status}`}>{STATUS_LABELS[doc.status]}</span></td>
                    <td><span className="wd-updated">{formatDate(doc.updatedAt)}</span></td>
                    <td className="wd-actions-cell">
                      <button type="button" className="wd-icon-button" data-menu aria-label={`Actions for ${doc.title}`} aria-expanded={menuId === doc.id} onClick={() => setMenuId(menuId === doc.id ? null : doc.id)}>
                        <MoreHorizontal size={17} />
                      </button>
                      {menuId === doc.id && (
                        <div className="folder-action-menu wd-action-menu" data-menu role="menu">
                          <button type="button" onClick={() => openFile(doc)}><Eye size={15} /> Preview</button>
                          <button type="button" onClick={() => openFile(doc, true)}><Download size={15} /> Download</button>
                          <button type="button" onClick={() => { setMenuId(null); setDialog({ type: "details", id: doc.id }); }}><Info size={15} /> Details & history</button>
                          {doc.status === "published" && primaryUrl && <a href={primaryUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> View on website</a>}
                          {editor && doc.status !== "archived" && <button type="button" onClick={() => { setMenuId(null); setDialog({ type: "edit", doc }); }}><Pencil size={15} /> Edit details</button>}
                          {editor && doc.status !== "archived" && <button type="button" onClick={() => { setMenuId(null); setDialog({ type: "replace", doc }); }}><RefreshCw size={15} /> Replace file</button>}
                          {editor && (doc.status === "draft" || doc.status === "unpublished") && <button type="button" onClick={() => requestStatus(doc, "publish")}><Globe2 size={15} /> Publish</button>}
                          {editor && doc.status === "published" && <button type="button" onClick={() => requestStatus(doc, "unpublish")}><EyeOff size={15} /> Unpublish</button>}
                          {editor && doc.status !== "archived" && <button type="button" onClick={() => requestStatus(doc, "archive")}><Archive size={15} /> Archive</button>}
                          {editor && doc.status === "archived" && <button type="button" onClick={() => requestStatus(doc, "restore")}><ArchiveRestore size={15} /> Restore</button>}
                          {admin && doc.status !== "published" && <button type="button" className="danger" onClick={() => requestDelete(doc)}><Trash2 size={15} /> Delete permanently</button>}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {loading && <div className="wd-loading"><Loader2 size={18} className="wd-spin" /> Loading documents…</div>}
          {!loading && !items.length && !loadError && (
            <div className="folder-empty-state wd-empty">
              <Globe2 size={30} />
              <h2>{filters.q || filters.categoryId || filters.financialYear || filters.status !== "active" ? "No matching documents" : "No documents yet"}</h2>
              <p>{editor ? "Upload a PDF and choose its category to publish it on the website." : "Documents uploaded by publishers will appear here."}</p>
            </div>
          )}
        </div>

        <div className="wd-pagination">
          <span>{pagination.total ? `Showing ${firstRow}–${lastRow} of ${pagination.total}` : ""}</span>
          <div>
            <button type="button" className="fp-btn fp-btn-cancel" onClick={() => setPage((value) => value - 1)} disabled={page <= 1 || loading}>Previous</button>
            <button type="button" className="fp-btn fp-btn-cancel" onClick={() => setPage((value) => value + 1)} disabled={page >= pagination.totalPages || loading}>Next</button>
          </div>
        </div>
      </section>

      {dialog?.type === "create" && <DocumentFormDialog mode="create" categories={categories} onClose={() => setDialog(null)} onSaved={(doc, warnings) => onSaved(doc, warnings, "uploaded")} />}
      {dialog?.type === "edit" && <DocumentFormDialog mode="edit" document={dialog.doc} categories={categories} onClose={() => setDialog(null)} onSaved={(doc) => onSaved(doc)} />}
      {dialog?.type === "replace" && <ReplaceFileDialog document={dialog.doc} onClose={() => setDialog(null)} onSaved={(doc) => onSaved(doc, [], "replaced")} />}
      {dialog?.type === "details" && (
        <DocumentDetailsDialog documentId={dialog.id} categories={categories} canEdit={editor} notify={notify} onClose={() => setDialog(null)} onChanged={refresh} />
      )}
      {dialog?.type === "confirm" && <ConfirmDialog {...dialog} onClose={() => setDialog(null)} />}
    </div>
  );
};

export default WebsiteDocuments;
