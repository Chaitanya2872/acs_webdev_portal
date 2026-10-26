import React, { useMemo, useRef, useState } from "react";
import { FilePlus2, FileText, Pencil, Plus, Trash2, UploadCloud, X } from "lucide-react";

import { checkPdfFile, createDocument, updateDocument, uploadPdf } from "../services/documentApi";
import { financialYearForDate, financialYearOptions, formatBytes, titleFromFileName } from "./documentUtils";

const rootOf = (categoryId, byId) => {
  let node = byId.get(categoryId);
  while (node?.parent) node = byId.get(node.parent.id);
  return node;
};

/** Upload a new document (mode "create") or edit an existing one's details (mode "edit"). */
const DocumentFormDialog = ({ mode, document, categories, onClose, onSaved }) => {
  const { tree, byId, leaves } = categories;
  const editing = mode === "edit";
  const fileInputRef = useRef(null);

  const initialCategoryId = document?.categoryId ?? "";
  const [rootId, setRootId] = useState(initialCategoryId ? rootOf(initialCategoryId, byId)?.id ?? "" : "");
  const [categoryId, setCategoryId] = useState(initialCategoryId);
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState(document?.title ?? "");
  const [displayFilename, setDisplayFilename] = useState(document?.displayFilename ?? "");
  const [financialYear, setFinancialYear] = useState(document?.financialYear ?? "");
  const [reportingPeriod, setReportingPeriod] = useState(document?.reportingPeriod ?? "");
  const [documentDate, setDocumentDate] = useState(document?.documentDate ?? "");
  const [displayOrder, setDisplayOrder] = useState(String(document?.displayOrder ?? 0));
  const [publish, setPublish] = useState(true);
  const [additional, setAdditional] = useState(
    (document?.placements ?? []).filter((placement) => !placement.isPrimary).map(({ categoryId: id, titleOverride, displayOrder: order }) => ({ categoryId: id, titleOverride: titleOverride ?? "", displayOrder: order })),
  );
  const [phase, setPhase] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  // Kept after a successful upload so a failed save can be retried without uploading again.
  const [uploaded, setUploaded] = useState(null);

  const root = byId.get(Number(rootId));
  const subcategories = root && !root.isLeaf ? root.children.filter((child) => child.isLeaf && child.isActive) : [];
  const busy = phase !== "idle";
  const yearOptions = useMemo(() => financialYearOptions([document?.financialYear]), [document?.financialYear]);

  const chooseRoot = (value) => {
    setRootId(value);
    const node = byId.get(Number(value));
    setCategoryId(node?.isLeaf ? node.id : "");
  };

  const chooseFile = async (selected) => {
    setError("");
    if (!selected) return;
    const problem = await checkPdfFile(selected);
    if (problem) {
      setError(problem);
      return;
    }
    setFile(selected);
    setUploaded(null);
    if (!title.trim()) setTitle(titleFromFileName(selected.name));
    setDisplayFilename(selected.name);
  };

  const changeDate = (value) => {
    setDocumentDate(value);
    if (!financialYear && value) setFinancialYear(financialYearForDate(value));
  };

  const validate = () => {
    if (!editing && !file) return "Choose the PDF to upload.";
    if (!categoryId) return root && !root.isLeaf ? `Choose a subcategory of ${root.name}.` : "Choose where the document appears on the website.";
    if (!title.trim()) return "Enter the title shown on the website.";
    if (!/^-?\d+$/.test(displayOrder.trim())) return "Display order must be a whole number.";
    if (additional.some((placement) => !placement.categoryId)) return "Choose a page for each additional placement, or remove it.";
    return "";
  };

  const metadata = () => ({
    title: title.trim(),
    categoryId: Number(categoryId),
    additionalPlacements: additional
      .filter((placement) => Number(placement.categoryId) !== Number(categoryId))
      .map((placement) => ({ categoryId: Number(placement.categoryId), titleOverride: placement.titleOverride.trim() || null, ...(placement.displayOrder !== undefined ? { displayOrder: placement.displayOrder } : {}) })),
    displayFilename: displayFilename.trim() || undefined,
    financialYear: financialYear || null,
    reportingPeriod: reportingPeriod.trim() || null,
    documentDate: documentDate || null,
    displayOrder: Number(displayOrder),
  });

  const submit = async (event) => {
    event.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError("");

    try {
      if (editing) {
        setPhase("saving");
        const saved = await updateDocument(document.id, metadata());
        onSaved(saved, []);
        return;
      }

      let uploadId = uploaded?.file === file ? uploaded.uploadId : null;
      if (!uploadId) {
        setPhase("uploading");
        setProgress(0);
        uploadId = await uploadPdf(file, setProgress);
        setUploaded({ file, uploadId });
      }
      setPhase("saving");
      const result = await createDocument({ uploadId, ...metadata(), publish });
      onSaved(result.document, result.warnings ?? []);
    } catch (submitError) {
      // A rejected file can't be reused; anything else (network, validation) can be retried with the same upload.
      if (["INVALID_PDF", "UPLOAD_SIZE_MISMATCH", "UPLOAD_ALREADY_USED", "UPLOAD_EXPIRED", "FILE_TOO_LARGE"].includes(submitError.code)) setUploaded(null);
      setError(submitError.message || "The document could not be saved.");
      setPhase("idle");
    }
  };

  const otherLeaves = leaves.filter((leaf) => leaf.isActive && leaf.id !== Number(categoryId));

  return (
    <div className="fp-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <form className="fp-modal wd-form-modal" role="dialog" aria-modal="true" aria-labelledby="wd-form-title" onSubmit={submit} noValidate>
        <div className="fp-modal-header-row">
          <div className="fp-modal-title">
            <div className="fp-icon-box fp-icon-view">{editing ? <Pencil size={18} /> : <FilePlus2 size={18} />}</div>
            <div>
              <h2 id="wd-form-title">{editing ? "Edit document details" : "Upload document"}</h2>
              <p>{editing ? "Changes appear on the website within a minute." : "PDF files only. The category decides which website page lists it."}</p>
            </div>
          </div>
          <button type="button" className="fp-modal-close" aria-label="Close" onClick={onClose} disabled={busy}><X size={18} /></button>
        </div>

        <div className="fp-modal-body wd-form-body">
          {!editing && (
            <div
              className={`wd-dropzone${file ? " has-file" : ""}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); chooseFile(event.dataTransfer.files?.[0]); }}
            >
              {file ? (
                <div className="wd-dropzone-file">
                  <FileText size={22} />
                  <div>
                    <strong>{file.name}</strong>
                    <span>{formatBytes(file.size)}</span>
                  </div>
                  <button type="button" className="fp-btn fp-btn-cancel" onClick={() => fileInputRef.current?.click()} disabled={busy}>Change</button>
                </div>
              ) : (
                <button type="button" className="wd-dropzone-empty" onClick={() => fileInputRef.current?.click()}>
                  <UploadCloud size={26} />
                  <strong>Choose a PDF or drop it here</strong>
                  <span>Maximum 50 MB</span>
                </button>
              )}
              <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = ""; }} />
            </div>
          )}

          <div className="wd-form-grid">
            <label className="wd-field">
              <span className="fp-label">Category</span>
              <select className="fp-input" value={rootId} onChange={(event) => chooseRoot(event.target.value)} disabled={busy}>
                <option value="">Select a category</option>
                {tree.filter((node) => node.isActive).map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}
              </select>
            </label>

            {subcategories.length > 0 && (
              <label className="wd-field">
                <span className="fp-label">Subcategory</span>
                <select className="fp-input" value={categoryId} onChange={(event) => setCategoryId(event.target.value ? Number(event.target.value) : "")} disabled={busy}>
                  <option value="">Select a subcategory</option>
                  {subcategories.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}
                </select>
              </label>
            )}

            <label className="wd-field wd-field-wide">
              <span className="fp-label">Title shown on the website</span>
              <input className="fp-input" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={300} placeholder="e.g. Outcome of Board Meeting 13 Aug 2026" disabled={busy} />
            </label>

            <label className="wd-field wd-field-wide">
              <span className="fp-label">File name visitors download</span>
              <input className="fp-input" value={displayFilename} onChange={(event) => setDisplayFilename(event.target.value)} maxLength={255} placeholder="Defaults to the uploaded file name" disabled={busy || (!editing && !file)} />
            </label>

            <label className="wd-field">
              <span className="fp-label">Document date</span>
              <input className="fp-input" type="date" value={documentDate} onChange={(event) => changeDate(event.target.value)} disabled={busy} />
            </label>

            <label className="wd-field">
              <span className="fp-label">Financial year</span>
              <select className="fp-input" value={financialYear} onChange={(event) => setFinancialYear(event.target.value)} disabled={busy}>
                <option value="">Not specified</option>
                {yearOptions.map((year) => <option key={year} value={year}>FY {year}</option>)}
              </select>
            </label>

            <label className="wd-field">
              <span className="fp-label">Reporting period</span>
              <input className="fp-input" value={reportingPeriod} onChange={(event) => setReportingPeriod(event.target.value)} maxLength={100} placeholder="e.g. Quarter ended 30 June 2026" disabled={busy} />
            </label>

            <label className="wd-field">
              <span className="fp-label">Display order</span>
              <input className="fp-input" type="number" step="1" value={displayOrder} onChange={(event) => setDisplayOrder(event.target.value)} disabled={busy} />
              <small className="wd-hint">Lower numbers are listed first; equal numbers list the newest date first.</small>
            </label>
          </div>

          <div className="wd-placements">
            <div className="wd-placements-head">
              <span className="fp-label">Also list on</span>
              <button type="button" className="wd-link-button" onClick={() => setAdditional((items) => [...items, { categoryId: "", titleOverride: "" }])} disabled={busy || additional.length >= 10}>
                <Plus size={14} /> Add page
              </button>
            </div>
            {additional.length === 0 && <p className="wd-hint">Optional — e.g. list a board meeting outcome on the Financial Results page too.</p>}
            {additional.map((placement, index) => (
              <div className="wd-placement-row" key={index}>
                <select
                  className="fp-input"
                  value={placement.categoryId}
                  onChange={(event) => setAdditional((items) => items.map((item, i) => (i === index ? { ...item, categoryId: event.target.value ? Number(event.target.value) : "", displayOrder: undefined } : item)))}
                  disabled={busy}
                  aria-label="Website page"
                >
                  <option value="">Select a page</option>
                  {otherLeaves.map((leaf) => <option key={leaf.id} value={leaf.id}>{leaf.path}</option>)}
                </select>
                <input
                  className="fp-input"
                  value={placement.titleOverride}
                  onChange={(event) => setAdditional((items) => items.map((item, i) => (i === index ? { ...item, titleOverride: event.target.value } : item)))}
                  placeholder="Title on that page (optional)"
                  maxLength={300}
                  disabled={busy}
                  aria-label="Title on that page"
                />
                <button type="button" className="fp-modal-close" aria-label="Remove page" onClick={() => setAdditional((items) => items.filter((_, i) => i !== index))} disabled={busy}><Trash2 size={16} /></button>
              </div>
            ))}
          </div>

          {!editing && (
            <label className="fp-confirm-row">
              <input type="checkbox" checked={publish} onChange={(event) => setPublish(event.target.checked)} disabled={busy} />
              <span>Publish on the website immediately (otherwise it is saved as a draft)</span>
            </label>
          )}

          {phase === "uploading" && (
            <div className="wd-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ width: `${progress}%` }} />
              <span>Uploading to secure storage… {progress}%</span>
            </div>
          )}
          {phase === "saving" && <p className="wd-hint" role="status">Checking the file and saving…</p>}
          {error && <p className="fp-error" role="alert">{error}</p>}
        </div>

        <div className="fp-modal-footer">
          <button type="button" className="fp-btn fp-btn-cancel" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="fp-btn fp-btn-primary" disabled={busy}>
            {busy ? "Saving…" : editing ? "Save changes" : publish ? "Upload and publish" : "Upload as draft"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default DocumentFormDialog;
